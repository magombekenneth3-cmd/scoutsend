import { GmailProvider } from "./gmail.provider";
import { OutlookProvider, OutlookProviderOptions } from "./outlook.provider";
import { SmtpProvider } from "./smt.provider";
import { MailboxCredentials, MailProvider } from "./types";

export interface CreateMailProviderOptions {
    outlook?: OutlookProviderOptions;
}

function assertNever(x: never): never {
    throw new Error(`Unsupported provider: ${(x as { type: string }).type}`);
}

export function createMailProvider(
    creds: MailboxCredentials,
    opts?: CreateMailProviderOptions
): MailProvider {
    switch (creds.type) {
        case "GMAIL":
            return new GmailProvider(creds);
        case "OUTLOOK":
            return new OutlookProvider(creds, opts?.outlook);
        case "SMTP":
            return new SmtpProvider(creds);
        default:
            return assertNever(creds);
    }
}

export { GmailProvider } from "./gmail.provider";
export { OutlookProvider } from "./outlook.provider";
export { SmtpProvider } from "./smt.provider";
export type { OutlookProviderOptions } from "./outlook.provider";
export * from "./types";