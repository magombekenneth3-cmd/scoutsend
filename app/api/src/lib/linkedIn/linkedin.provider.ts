export type LinkedInProviderType =
    | "UNIPILE"
    | "PHANTOMBUSTER"
    | "PLAYWRIGHT"
    | "BROWSER_USE"
    | "CUSTOM";


export type ProviderErrorCode =
    | "RATE_LIMIT"
    | "AUTH_EXPIRED"
    | "PROFILE_NOT_FOUND"
    | "INVITATION_LIMIT"
    | "MESSAGE_BLOCKED"
    | "TIMEOUT"
    | "NETWORK_ERROR"
    | "UNKNOWN";

export type ContactRestrictionReason =
    | "ALREADY_CONNECTED"
    | "PENDING_REQUEST"
    | "RATE_LIMIT"
    | "DO_NOT_CONTACT"
    | "BLOCKED";

export type LinkedInActivityType =
    | "PROFILE_VIEW"
    | "CONNECTION_SENT"
    | "CONNECTION_ACCEPTED"
    | "MESSAGE_SENT"
    | "MESSAGE_RECEIVED";

export type LinkedInWebhookEventType =
    | "MESSAGE_RECEIVED"
    | "CONNECTION_ACCEPTED"
    | "CONNECTION_REQUEST_RECEIVED"
    | "PROFILE_VIEWED";

export type LinkedInCapability =
    | "VISIT_PROFILE"
    | "CONNECT"
    | "WITHDRAW_CONNECT"
    | "MESSAGE"
    | "INMAIL"
    | "PROFILE_LOOKUP"
    | "LIST_CONVERSATIONS"
    | "REALTIME_EVENTS"
    | "ASYNC_OPERATIONS";

export interface LinkedInProfileRef {
    profileUrl?: string;
    linkedinId?: string;
    providerId?: string;
}

export interface ProviderError {
    code: ProviderErrorCode;
    message: string;
    retryAfterSeconds?: number;
}

export interface LinkedInAccountContext {
    accountId: string;
    tenantId?: string;
    workspaceId?: string;
}

export interface LinkedInActionMetadata {
    provider: LinkedInProviderType;
    executedAt: Date;
    accountId: string;
}

export type LinkedInOperationResult<T> =
    | {
        async: true;
        jobId: string;
        metadata: LinkedInActionMetadata;
    }
    | {
        async: false;
        result: T;
        metadata: LinkedInActionMetadata;
    }
    | {
        async: false;
        error: ProviderError;
        metadata: LinkedInActionMetadata;
    };

export interface LinkedInJobStatus<T = unknown> {
    jobId: string;
    status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
    progress?: number;
    result?: T;
    error?: ProviderError;
}

export interface LinkedInVisitResult {
    profile: LinkedInProfileRef;
}

export interface LinkedInConnectResult {
    invitationId?: string;
}

export interface LinkedInMessageResult {
    messageId?: string;
}

export interface LinkedInConnectionStatus {
    connected: boolean;
    pending: boolean;
}

export interface LinkedInProfile {
    profileUrl: string;
    firstName?: string;
    lastName?: string;
    fullName: string;
    headline?: string;
    company?: string;
    title?: string;
    location?: string;
    summary?: string;
    connectionsCount?: number;
    avatarUrl?: string;
}

export interface LinkedInAttachment {
    id: string;
    type: "DOCUMENT" | "IMAGE" | "VIDEO";
    url: string;
    name?: string;
    mimeType?: string;
}

export interface LinkedInMessageContent {
    text: string;
    attachments?: LinkedInAttachment[];
}

export interface LinkedInMessage {
    id: string;
    conversationId: string;
    senderId: string;
    content: LinkedInMessageContent;
    sentAt: Date;
}

export interface PaginatedConversation {
    conversationId: string;
    participants: LinkedInProfileRef[];
    messages: LinkedInMessage[];
    nextCursor?: string;
}

export interface LinkedInConversationSummary {
    conversationId: string;
    participants: LinkedInProfileRef[];
    lastMessage?: LinkedInMessage;
    unreadCount?: number;
    updatedAt: Date;
}

export interface PaginatedConversationList {
    conversations: LinkedInConversationSummary[];
    nextCursor?: string;
}

export interface LinkedInActivity {
    id: string;
    type: LinkedInActivityType;
    profile: LinkedInProfileRef;
    occurredAt: Date;
    metadata?: Record<string, unknown>;
}

export interface LinkedInWebhookEvent {
    eventId: string;
    type: LinkedInWebhookEventType;
    accountId: string;
    provider: LinkedInProviderType;
    profile: LinkedInProfileRef;
    timestamp: Date;
    payload: Record<string, unknown>;
}

export interface WebhookProcessingResult {
    verified: boolean;
    event?: LinkedInWebhookEvent;
    error?: string;
}

export interface RateLimitInfo {
    remaining?: number;
    resetAt?: Date;
}

export interface ProviderHealth {
    healthy: boolean;
    authenticated: boolean;
    provider: LinkedInProviderType;
    accountId?: string;
    version?: string;
    providerInstanceId?: string;
    capabilities: LinkedInCapability[];
    rateLimits?: RateLimitInfo;
    error?: string;
}

export interface ConfigurationValidationResult {
    valid: boolean;
    errors?: string[];
}

export interface LinkedInRequestOptions {
    idempotencyKey?: string;
}

export interface LinkedInSearchResultItem {
    profileUrl: string;
    fullName?: string;
    firstName?: string;
    lastName?: string;
    headline?: string;
    company?: string;
    title?: string;
    location?: string;
}

export interface LinkedInSearchResult {
    items: LinkedInSearchResultItem[];
    cursor?: string;
}

export interface ChannelProvider {
    health(account: LinkedInAccountContext): Promise<ProviderHealth>;
    validateConfiguration(config: Record<string, unknown>): Promise<ConfigurationValidationResult>;
}

export interface LinkedInProvider extends ChannelProvider {
    searchPeople(
        account: LinkedInAccountContext,
        options: { queryUrl: string; cursor?: string },
    ): Promise<LinkedInSearchResult>;

    getJobStatus<T>(
        account: LinkedInAccountContext,
        jobId: string,
    ): Promise<LinkedInJobStatus<T>>;

    cancelJob(
        account: LinkedInAccountContext,
        jobId: string,
    ): Promise<boolean>;

    visitProfile(
        account: LinkedInAccountContext,
        profile: LinkedInProfileRef,
        options?: LinkedInRequestOptions,
    ): Promise<LinkedInOperationResult<LinkedInVisitResult>>;

    sendConnectionRequest(
        account: LinkedInAccountContext,
        profile: LinkedInProfileRef,
        note?: string,
        options?: LinkedInRequestOptions,
    ): Promise<LinkedInOperationResult<LinkedInConnectResult>>;

    withdrawConnectionRequest(
        account: LinkedInAccountContext,
        profile: LinkedInProfileRef,
        options?: LinkedInRequestOptions,
    ): Promise<LinkedInOperationResult<{ success: boolean }>>;

    sendMessage(
        account: LinkedInAccountContext,
        profile: LinkedInProfileRef,
        content: LinkedInMessageContent,
        options?: LinkedInRequestOptions,
    ): Promise<LinkedInOperationResult<LinkedInMessageResult>>;

    sendInMail(
        account: LinkedInAccountContext,
        profile: LinkedInProfileRef,
        subject: string,
        content: LinkedInMessageContent,
        options?: LinkedInRequestOptions,
    ): Promise<LinkedInOperationResult<LinkedInMessageResult>>;

    checkConnectionStatus(
        account: LinkedInAccountContext,
        profile: LinkedInProfileRef,
    ): Promise<LinkedInConnectionStatus>;

    getProfile(
        account: LinkedInAccountContext,
        profile: LinkedInProfileRef,
    ): Promise<LinkedInProfile>;

    listConversations(
        account: LinkedInAccountContext,
        options?: { cursor?: string; limit?: number },
    ): Promise<PaginatedConversationList>;

    getConversation(
        account: LinkedInAccountContext,
        profile: LinkedInProfileRef,
        options?: { cursor?: string; limit?: number },
    ): Promise<PaginatedConversation>;

    getActivity(
        account: LinkedInAccountContext,
        profile: LinkedInProfileRef,
        options?: { startTime?: Date; limit?: number },
    ): Promise<LinkedInActivity[]>;

    canContact(
        account: LinkedInAccountContext,
        profile: LinkedInProfileRef,
    ): Promise<{
        allowed: boolean;
        reason?: ContactRestrictionReason;
    }>;

    handleWebhook(
        payload: Record<string, unknown>,
        signature?: string,
    ): Promise<WebhookProcessingResult>;
}