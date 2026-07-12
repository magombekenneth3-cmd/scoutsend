export type MailProviderType = "GMAIL" | "OUTLOOK" | "SMTP";

export interface SendEmailParams {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
    inReplyTo?: string;
    references?: string;
    headers?: Record<string, string>;
}

export interface SendEmailResult {
    success: true;
    externalId: string;
}

export interface SendEmailError {
    success: false;
    error: string;
}

export type SendResult = SendEmailResult | SendEmailError;


export interface InboundReply {
    providerMessageId: string;
    inReplyToId: string | null;
    fromEmail: string;
    subject: string;
    bodyText: string;
    receivedAt: Date;
}

export interface MailProvider {
    readonly type: MailProviderType;
    sendEmail(params: SendEmailParams): Promise<SendResult>;
    fetchReplies(since: Date): Promise<InboundReply[]>;
    verify(): Promise<boolean>;
}


export interface SmtpCredentials {
    type: "SMTP";
    smtpHost: string;
    smtpPort: number;
    secure: boolean;
    username: string;
    password: string;
    imapHost?: string;
    imapPort?: number;
}

export interface GmailCredentials {
    type: "GMAIL";
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    emailAddress: string;
}

export interface OutlookCredentials {
    type: "OUTLOOK";
    clientId: string;
    clientSecret: string;
    tenantId: string;
    refreshToken: string;
    emailAddress: string;
}

export type MailboxCredentials =
    | SmtpCredentials
    | GmailCredentials
    | OutlookCredentials;