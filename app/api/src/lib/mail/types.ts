export type MailProviderType = "GMAIL" | "OUTLOOK" | "SMTP";

export interface EmailAttachment {
    filename: string;
    content: Buffer | string;
    contentType?: string;
}

export interface SendEmailParams {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
    /**
     * Deterministic idempotency key from the originating SendIntent.
     * Providers that support idempotency (e.g. future Message-ID header locking)
     * SHOULD use this. Providers that do not support it MUST declare so in
     * their ProviderCapabilities — callers will route UNKNOWN outcomes
     * to the appropriate reconciliation strategy.
     */
    idempotencyKey?: string;
    inReplyTo?: string;
    references?: string;
    headers?: Record<string, string>;
    attachments?: EmailAttachment[];
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

/**
 * Declares what this provider can do at the capability level.
 *
 * reconciliationStrategy drives UNKNOWN resolution in Sprint 4:
 *   LOOKUP        — provider can confirm delivery given externalId; auto-reconcile safe
 *   MANUAL_REVIEW — no lookup API; UNKNOWN must escalate to operator after exhausting retries
 */
export type ReconciliationStrategy = "LOOKUP" | "MANUAL_REVIEW";

export interface ProviderCapabilities {
    /**
     * True if the provider accepts and honours a client-supplied idempotency key,
     * guaranteeing at-most-once delivery on retry.
     */
    supportsIdempotency: boolean;
    /**
     * True if the provider exposes an API to confirm delivery status by
     * externalId after the fact (used by the reconciliation sweeper).
     */
    supportsLookup: boolean;
    /**
     * Strategy the reconciliation sweeper must apply when this provider's
     * SendIntent lands in UNKNOWN state.
     */
    reconciliationStrategy: ReconciliationStrategy;
}

export interface InboundReply {
    providerMessageId: string;
    inReplyToId: string | null;
    fromEmail: string;
    subject: string;
    bodyText: string;
    receivedAt: Date;
}

export type MessageFolder = "INBOX" | "SPAM" | "OTHER";

/**
 * Result of a provider-side delivery status lookup.
 *
 *   FOUND     — provider confirmed message was delivered/accepted; externalId is valid
 *   NOT_FOUND — provider has no record of this message (definitely not delivered)
 *   UNKNOWN   — provider returned an inconclusive result (try again later)
 */
export type LookupStatus = "FOUND" | "NOT_FOUND" | "UNKNOWN";

export interface LookupResult {
    status: LookupStatus;
    /** Returned by the provider if it re-confirms the external message ID. */
    externalId?: string;
    error?: string;
}

export interface MailProvider {
    readonly type: MailProviderType;
    /**
     * Returns the static capability declaration for this provider.
     * Must be pure (no I/O). Called before and after dispatch to
     * determine reconciliation routing.
     */
    getCapabilities(): ProviderCapabilities;
    sendEmail(params: SendEmailParams): Promise<SendResult>;
    fetchReplies(since: Date): Promise<InboundReply[]>;
    verify(): Promise<boolean>;

    /**
     * Provider-side delivery status lookup.
     * Only required if getCapabilities().supportsLookup === true.
     * The sweeper will NOT call this method on providers where supportsLookup is false.
     *
     * @param externalId  The ID returned by sendEmail() (may be undefined if send threw)
     * @param idempotencyKey  The SendIntent's deterministic idempotency key
     */
    lookupMessage?(params: {
        externalId?: string;
        idempotencyKey: string;
    }): Promise<LookupResult>;

    findMessageFolder?(externalId: string): Promise<MessageFolder>;
    moveToInbox?(externalId: string): Promise<void>;
    markAsRead?(externalId: string): Promise<void>;
    markAsImportant?(externalId: string): Promise<void>;
    moveToPrimary?(externalId: string): Promise<void>;
    sendReplyInThread?(params: {
        to: string;
        subject: string;
        body: string;
        inReplyTo: string;
        references?: string;
    }): Promise<SendResult>;
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
    dkim?: {
        domainName: string;
        keySelector: string;
        privateKey: string;
    };
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