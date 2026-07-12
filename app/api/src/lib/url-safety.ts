import dns from "node:dns/promises";
import net from "node:net";

const PRIVATE_V4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function ipv4ToLong(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + parseInt(o, 10), 0) >>> 0;
}

function isPrivateV4(ip: string): boolean {
  const n = ipv4ToLong(ip);
  return PRIVATE_V4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4ToLong(base) & mask);
  });
}

function isPrivateV6(ip: string): boolean {
  const l = ip.toLowerCase();
  return (
    l === "::1" ||
    l.startsWith("fe80:") ||
    l.startsWith("fc") ||
    l.startsWith("fd") ||
    l.startsWith("::ffff:127.") ||
    l.startsWith("::ffff:10.") ||
    l.startsWith("::ffff:169.254.") ||
    l.startsWith("::ffff:192.168.")
  );
}

function assertNotPrivate(addr: string, host: string): void {
  const version = net.isIP(addr);
  if (
    (version === 4 && isPrivateV4(addr)) ||
    (version === 6 && isPrivateV6(addr))
  ) {
    throw new Error(`Refusing private address for host ${host}: ${addr}`);
  }
}

export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported protocol: ${url.protocol}`);
  }

  if (url.username || url.password) {
    throw new Error("Credentials in URL not allowed");
  }

  const host = url.hostname;

  if (net.isIP(host)) {
    assertNotPrivate(host, host);
    return url;
  }

  const [v4Result, v6Result] = await Promise.allSettled([
    dns.resolve4(host).catch((): string[] => []),
    dns.resolve6(host).catch((): string[] => []),
  ]);

  const addrs = [
    ...(v4Result.status === "fulfilled" ? v4Result.value : []),
    ...(v6Result.status === "fulfilled" ? v6Result.value : []),
  ];

  if (addrs.length === 0) {
    throw new Error(`Could not resolve host: ${host}`);
  }

  for (const addr of addrs) {
    assertNotPrivate(addr, host);
  }

  return url;
}
