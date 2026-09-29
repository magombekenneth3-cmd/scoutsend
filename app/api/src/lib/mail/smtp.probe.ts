import { Socket } from "net";
import { connect as tlsConnect, TLSSocket } from "tls";

export type SmtpStage =
  | "connect"
  | "banner"
  | "ehlo"
  | "helo"
  | "starttls"
  | "tls_handshake"
  | "ehlo_secure"
  | "mail_from"
  | "rcpt_to"
  | "quit"
  | "complete";

export type SmtpResultStatus =
  | "valid"
  | "invalid"
  | "retry"
  | "unknown"
  | "full"
  | "cancelled";

export interface SmtpCapabilities {
  startTls: boolean;
  pipelining: boolean;
  eightBitMime: boolean;
  smtpUtf8: boolean;
  size?: number;
  auth: string[];
}

export interface SmtpTimings {
  connectMs: number | null;
  bannerMs: number | null;
  ehloMs: number | null;
  starttlsMs: number | null;
  tlsMs: number | null;
  mailFromMs: number | null;
  rcptToMs: number | null;
  totalMs: number;
}

export interface SmtpProbeResult {
  code: number | null;
  message: string;
  stage: SmtpStage;
  status: SmtpResultStatus;
  transient: boolean;
  providerHint?: string;
  banner?: string;
  capabilities?: SmtpCapabilities;
  capabilitiesBeforeTls?: SmtpCapabilities;
  usedHeloFallback: boolean;
  tlsUsed: boolean;
  tlsAuthorized?: boolean;
  tlsAuthorizationError?: string;
  tlsProtocol?: string | null;
  mxHost: string;
  timings: SmtpTimings;
}

export interface SmtpProbeOptions {
  host: string;
  port?: number;
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
  ehloDomain: string;
  mailFrom: string;
  rcptTo: string;
  useStartTls?: boolean;
  allowPlaintextFallback?: boolean;
  rejectUnauthorizedTls?: boolean;
  signal?: AbortSignal;
}

export interface ProbeRcptWithFailoverOptions extends Omit<SmtpProbeOptions, "host"> {
  hosts: string[];
}

export const RCPT_STATUS_BY_CODE: Record<number, { status: SmtpResultStatus; description: string }> = {
  250: { status: "valid", description: "Requested mail action okay, completed" },
  251: { status: "valid", description: "User not local; will forward" },
  252: { status: "unknown", description: "Cannot verify user, but will accept and attempt delivery" },
  421: { status: "retry", description: "Service not available, closing transmission channel" },
  450: { status: "retry", description: "Mailbox unavailable (often greylisting)" },
  451: { status: "retry", description: "Local error in processing" },
  452: { status: "full", description: "Insufficient system storage / mailbox full" },
  500: { status: "invalid", description: "Syntax error, command unrecognized" },
  501: { status: "invalid", description: "Syntax error in parameters or arguments" },
  502: { status: "unknown", description: "Command not implemented" },
  503: { status: "unknown", description: "Bad sequence of commands" },
  504: { status: "unknown", description: "Command parameter not implemented" },
  550: { status: "invalid", description: "Mailbox unavailable / does not exist" },
  551: { status: "unknown", description: "User not local; try forwarding path" },
  552: { status: "full", description: "Mailbox full / quota exceeded" },
  553: { status: "invalid", description: "Mailbox name not allowed" },
  554: { status: "unknown", description: "Transaction failed" },
};

export function classifySmtpResponse(code: number): {
  status: SmtpResultStatus;
  description: string;
} {
  const known = RCPT_STATUS_BY_CODE[code];
  if (known) return known;
  if (code >= 200 && code < 300) return { status: "valid", description: "Success" };
  if (code >= 400 && code < 500) return { status: "retry", description: "Transient failure" };
  if (code >= 500 && code < 600) return { status: "invalid", description: "Permanent failure" };
  return { status: "unknown", description: "Unrecognized response code" };
}

export function detectProvider(banner: string): string | undefined {
  const b = banner.toLowerCase();
  if (b.includes("google") || b.includes("gmail")) return "google";
  if (b.includes("outlook") || b.includes("protection.outlook.com")) return "microsoft365";
  if (b.includes("proofpoint") || b.includes("pphosted")) return "proofpoint";
  if (b.includes("mimecast")) return "mimecast";
  if (b.includes("postfix")) return "postfix";
  if (b.includes("exim")) return "exim";
  if (b.includes("sendmail")) return "sendmail";
  if (b.includes("yahoo")) return "yahoo";
  if (b.includes("zoho")) return "zoho";
  return undefined;
}

function parseCapabilities(lines: string[]): SmtpCapabilities {
  const caps: SmtpCapabilities = {
    startTls: false,
    pipelining: false,
    eightBitMime: false,
    smtpUtf8: false,
    auth: [],
  };

  for (const rawLine of lines) {
    if (!/^\d{3}[ -]/.test(rawLine)) continue;

    const text = rawLine.slice(4).trim();
    const upper = text.toUpperCase();

    if (upper === "STARTTLS") caps.startTls = true;
    else if (upper === "PIPELINING") caps.pipelining = true;
    else if (upper === "8BITMIME") caps.eightBitMime = true;
    else if (upper === "SMTPUTF8") caps.smtpUtf8 = true;
    else if (/^SIZE(?:\s|$)/.test(upper)) {
      const n = parseInt(upper.slice(4).trim(), 10);
      if (!Number.isNaN(n)) caps.size = n;
    } else if (/^AUTH(?:\s|$)/.test(upper)) {
      caps.auth = upper.slice(4).trim().split(/\s+/).filter(Boolean);
    }
  }

  return caps;
}

function isNonAscii(value: string): boolean {
  return /[^\x00-\x7F]/.test(value);
}

function isRetryableEhloFailure(code: number): boolean {
  return code === 500 || code === 502;
}

function validateResponseBlock(lines: string[]): { code: number; error?: string } {
  if (lines.length === 0) return { code: 0, error: "empty SMTP response block" };

  const first = lines[0];
  if (!/^\d{3}[ -]/.test(first)) {
    return { code: 0, error: `malformed SMTP response line: ${first}` };
  }

  const code = Number.parseInt(first.slice(0, 3), 10);

  for (const line of lines) {
    if (!/^\d{3}[ -]/.test(line)) {
      return { code, error: `malformed SMTP response line: ${line}` };
    }

    const lineCode = Number.parseInt(line.slice(0, 3), 10);
    if (lineCode !== code) {
      return { code, error: `inconsistent SMTP response codes: expected ${code}, got ${lineCode}` };
    }
  }

  return { code };
}

export function probeRcpt(opts: SmtpProbeOptions): Promise<SmtpProbeResult> {
  const port = opts.port ?? 25;
  const connectTimeoutMs = opts.connectTimeoutMs ?? 8000;
  const commandTimeoutMs = opts.commandTimeoutMs ?? 8000;
  const useStartTls = opts.useStartTls ?? true;
  const allowPlaintextFallback = opts.allowPlaintextFallback ?? false;
  const rejectUnauthorizedTls = opts.rejectUnauthorizedTls ?? true;

  return new Promise((resolve) => {
    const t0 = Date.now();
    let lastCheckpoint = t0;
    const elapsedSinceCheckpoint = () => {
      const now = Date.now();
      const delta = now - lastCheckpoint;
      lastCheckpoint = now;
      return delta;
    };
    const resetCheckpoint = () => {
      lastCheckpoint = Date.now();
    };

    const timings: SmtpTimings = {
      connectMs: null,
      bannerMs: null,
      ehloMs: null,
      starttlsMs: null,
      tlsMs: null,
      mailFromMs: null,
      rcptToMs: null,
      totalMs: 0,
    };

    const plainSocket = new Socket();
    let activeSocket: Socket | TLSSocket = plainSocket;
    let stage: SmtpStage = "connect";
    let settled = false;
    let recvBuffer = "";
    let responseLines: string[] = [];
    let usedHeloFallback = false;
    let capabilities: SmtpCapabilities | undefined;
    let capabilitiesBeforeTls: SmtpCapabilities | undefined;
    let banner: string | undefined;
    let providerHint: string | undefined;
    let tlsUsed = false;
    let tlsAuthorized: boolean | undefined;
    let tlsAuthorizationError: string | undefined;
    let tlsProtocol: string | null | undefined;
    let closeTimer: NodeJS.Timeout | null = null;

    const buildResult = (
      code: number | null,
      message: string,
      finalStage: SmtpStage,
      status: SmtpResultStatus,
    ): SmtpProbeResult => ({
      code,
      message,
      stage: finalStage,
      status,
      transient: status === "retry",
      providerHint,
      banner,
      capabilities,
      capabilitiesBeforeTls,
      usedHeloFallback,
      tlsUsed,
      tlsAuthorized,
      tlsAuthorizationError,
      tlsProtocol,
      mxHost: opts.host,
      timings,
    });

    const destroyAll = () => {
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
      activeSocket.removeAllListeners();
      activeSocket.destroy();
      if (activeSocket !== plainSocket && !plainSocket.destroyed) {
        plainSocket.removeAllListeners();
        plainSocket.destroy();
      }
    };

    const finish = (
      code: number | null,
      message: string,
      finalStage: SmtpStage,
      status: SmtpResultStatus,
    ) => {
      if (settled) return;
      settled = true;
      if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
      timings.totalMs = Date.now() - t0;
      destroyAll();
      resolve(buildResult(code, message, finalStage, status));
    };

    const finishAndCloseGracefully = (
      code: number | null,
      message: string,
      status: SmtpResultStatus,
    ) => {
      if (settled) return;
      settled = true;
      if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
      timings.totalMs = Date.now() - t0;

      const socketToClose = activeSocket;
      const plainToClose = plainSocket;

      try {
        if (!socketToClose.destroyed) {
          socketToClose.write("QUIT\r\n");
          socketToClose.end();
        }
      } catch {
        socketToClose.destroy();
      }

      resolve(buildResult(code, message, "complete", status));

      closeTimer = setTimeout(() => {
        socketToClose.removeAllListeners();
        socketToClose.destroy();
        if (socketToClose !== plainToClose && !plainToClose.destroyed) {
          plainToClose.removeAllListeners();
          plainToClose.destroy();
        }
        closeTimer = null;
      }, 300);
      closeTimer.unref();
    };

    const onAbort = () => finish(null, "probe cancelled", stage, "cancelled");

    if (opts.signal) {
      if (opts.signal.aborted) {
        finish(null, "probe cancelled", "connect", "cancelled");
        return;
      }
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    const onTimeout = () => finish(null, `timeout at ${stage}`, stage, "retry");
    const onError = (err: Error) => finish(null, err.message, stage, "retry");

    const send = (line: string) => {
      if (settled || activeSocket.destroyed) return;
      try {
        activeSocket.write(`${line}\r\n`);
      } catch (err) {
        finish(null, err instanceof Error ? err.message : String(err), stage, "retry");
      }
    };

    const attachSocketHandlers = (sock: Socket | TLSSocket) => {
      sock.on("data", onData);
      sock.once("timeout", onTimeout);
      sock.once("error", onError);
    };

    const sendMailFrom = () => {
      stage = "mail_from";
      resetCheckpoint();
      const needsUtf8 = isNonAscii(opts.mailFrom) || isNonAscii(opts.rcptTo);
      const utf8Supported = capabilities?.smtpUtf8 === true;

      if (needsUtf8 && !utf8Supported) {
        finish(null, "address requires SMTPUTF8, which this server does not advertise", "mail_from", "unknown");
        return;
      }

      send(`MAIL FROM:<${opts.mailFrom}>${needsUtf8 ? " SMTPUTF8" : ""}`);
    };

    const upgradeToTls = () => {
      stage = "tls_handshake";
      resetCheckpoint();

      plainSocket.removeListener("data", onData);
      plainSocket.removeListener("timeout", onTimeout);
      plainSocket.removeListener("error", onError);

      const secureSocket = tlsConnect({
        socket: plainSocket,
        servername: opts.host,
        rejectUnauthorized: rejectUnauthorizedTls,
      });

      activeSocket = secureSocket;

      secureSocket.setTimeout(commandTimeoutMs);
      secureSocket.once("timeout", onTimeout);
      secureSocket.once("error", onError);

      secureSocket.once("secureConnect", () => {
        if (settled) return;

        tlsUsed = true;
        tlsAuthorized = secureSocket.authorized;
        tlsAuthorizationError = secureSocket.authorizationError
          ? String(secureSocket.authorizationError)
          : undefined;
        tlsProtocol = secureSocket.getProtocol();
        timings.tlsMs = elapsedSinceCheckpoint();

        recvBuffer = "";
        responseLines = [];

        secureSocket.on("data", onData);
        stage = "ehlo_secure";
        resetCheckpoint();

        send(`EHLO ${opts.ehloDomain}`);
      });
    };

    const onResponseBlock = (lines: string[]) => {
      const validation = validateResponseBlock(lines);

      if (validation.error) {
        finish(null, validation.error, stage, "unknown");
        return;
      }

      const code = validation.code;
      const last = lines[lines.length - 1];

      switch (stage) {
        case "connect": {
          banner = last;
          providerHint = detectProvider(last);
          timings.bannerMs = elapsedSinceCheckpoint();

          if (code === 220) {
            stage = "ehlo";
            resetCheckpoint();
            send(`EHLO ${opts.ehloDomain}`);
          } else {
            finish(code, last, "banner", classifySmtpResponse(code).status);
          }
          return;
        }

        case "ehlo": {
          if (code === 250) {
            timings.ehloMs = elapsedSinceCheckpoint();
            capabilities = parseCapabilities(lines);

            if (useStartTls && capabilities.startTls) {
              capabilitiesBeforeTls = capabilities;
              stage = "starttls";
              resetCheckpoint();
              send("STARTTLS");
            } else {
              sendMailFrom();
            }
          } else if (!usedHeloFallback && isRetryableEhloFailure(code)) {
            usedHeloFallback = true;
            stage = "helo";
            resetCheckpoint();
            send(`HELO ${opts.ehloDomain}`);
          } else {
            finish(code, last, "ehlo", classifySmtpResponse(code).status);
          }
          return;
        }

        case "helo": {
          if (code === 250) {
            timings.ehloMs = elapsedSinceCheckpoint();
            sendMailFrom();
          } else {
            finish(code, last, "helo", classifySmtpResponse(code).status);
          }
          return;
        }

        case "starttls": {
          if (code === 220) {
            timings.starttlsMs = elapsedSinceCheckpoint();
            upgradeToTls();
          } else if (allowPlaintextFallback) {
            sendMailFrom();
          } else {
            const verdict = classifySmtpResponse(code);
            finish(code, last, "starttls", verdict.status);
          }
          return;
        }

        case "ehlo_secure": {
          if (code === 250) {
            capabilities = parseCapabilities(lines);
            sendMailFrom();
          } else {
            finish(code, last, "ehlo_secure", classifySmtpResponse(code).status);
          }
          return;
        }

        case "mail_from": {
          if (code === 250) {
            timings.mailFromMs = elapsedSinceCheckpoint();
            stage = "rcpt_to";
            resetCheckpoint();
            send(`RCPT TO:<${opts.rcptTo}>`);
          } else {
            finish(code, last, "mail_from", classifySmtpResponse(code).status);
          }
          return;
        }

        case "rcpt_to": {
          timings.rcptToMs = elapsedSinceCheckpoint();
          const verdict = classifySmtpResponse(code);

          stage = "quit";
          finishAndCloseGracefully(code, last, verdict.status);
          return;
        }

        case "quit":
        case "complete":
          return;
      }
    };

    const onData = (chunk: Buffer) => {
      if (settled) return;

      recvBuffer += chunk.toString("utf8");

      let idx: number;

      while ((idx = recvBuffer.indexOf("\r\n")) !== -1) {
        const line = recvBuffer.slice(0, idx);
        recvBuffer = recvBuffer.slice(idx + 2);

        if (line.length === 0) continue;

        const isFinalLine = /^\d{3} /.test(line);
        const isContinuationLine = /^\d{3}-/.test(line);

        if (!isFinalLine && !isContinuationLine) {
          finish(null, `malformed SMTP response line: ${line}`, stage, "unknown");
          return;
        }

        responseLines.push(line);

        if (isFinalLine) {
          const block = responseLines;
          responseLines = [];

          onResponseBlock(block);

          if (settled) return;
        }
      }
    };

    attachSocketHandlers(plainSocket);
    plainSocket.setTimeout(connectTimeoutMs);

    plainSocket.connect(port, opts.host, () => {
      if (settled) return;

      timings.connectMs = elapsedSinceCheckpoint();
      resetCheckpoint();
      plainSocket.setTimeout(commandTimeoutMs);
    });
  });
}

export async function probeRcptWithFailover(
  opts: ProbeRcptWithFailoverOptions,
): Promise<SmtpProbeResult> {
  const { hosts, ...rest } = opts;

  if (hosts.length === 0) {
    throw new Error("probeRcptWithFailover requires at least one host");
  }

  let last: SmtpProbeResult | null = null;

  for (const host of hosts) {
    if (opts.signal?.aborted) break;

    last = await probeRcpt({ ...rest, host });

    if (last.status !== "retry") {
      return last;
    }
  }

  if (last) {
    return last;
  }

  return {
    code: null,
    message: "probe cancelled before any host was attempted",
    stage: "connect",
    status: "cancelled",
    transient: false,
    usedHeloFallback: false,
    tlsUsed: false,
    mxHost: hosts[hosts.length - 1] ?? "",
    timings: {
      connectMs: null,
      bannerMs: null,
      ehloMs: null,
      starttlsMs: null,
      tlsMs: null,
      mailFromMs: null,
      rcptToMs: null,
      totalMs: 0,
    },
  };
}
