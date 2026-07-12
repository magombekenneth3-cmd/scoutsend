import { randomUUID } from "crypto";
import {
    LinkedInProvider,
    LinkedInProfileRef,
    LinkedInAccountContext,
    LinkedInOperationResult,
    LinkedInVisitResult,
    LinkedInConnectResult,
    LinkedInMessageResult,
    LinkedInConnectionStatus,
    LinkedInProfile,
    PaginatedConversationList,
    PaginatedConversation,
    LinkedInActivity,
    ContactRestrictionReason,
    WebhookProcessingResult,
    ProviderHealth,
    ConfigurationValidationResult,
    LinkedInRequestOptions,
    LinkedInJobStatus,
    LinkedInMessageContent,
    ProviderError,
    ProviderErrorCode,
    LinkedInSearchResult,
} from "./linkedin.provider";
import { logger } from "../logger";

interface UnipileAccountsResponse {
    object: "UserAccountList";
    items: Array<{ object: string; id: string; name: string; type: string }>;
}

interface UnipileInviteResponse {
    object: string;
    id: string;
}

interface UnipileMessageResponse {
    object: string;
    id: string;
}

interface UnipileRelationResponse {
    object: string;
    status: string;
}

interface UnipileProfileResponse {
    id: string;
    first_name?: string;
    last_name?: string;
    public_url: string;
    headline?: string;
    company?: string;
    title?: string;
    location?: string;
    summary?: string;
    connections_count?: number;
    avatar_url?: string;
}

class UnipileHttpError extends Error {
    constructor(
        public readonly status: number,
        public readonly method: string,
        public readonly path: string,
        public readonly responseText: string,
        public readonly headers?: Headers,
    ) {
        super(`[unipile] ${method} ${path} → HTTP ${status}: ${responseText}`);
        this.name = "UnipileHttpError";
    }
}

export interface UnipileProviderOptions {
    baseUrl: string;
    apiKey: string;
    timeoutMs?: number;
}

export class UnipileLinkedInProvider implements LinkedInProvider {
    private readonly baseUrl: string;
    private readonly apiKey: string;
    private readonly timeoutMs: number;

    constructor(opts: UnipileProviderOptions) {
        this.baseUrl = opts.baseUrl.replace(/\/$/, "");
        this.apiKey = opts.apiKey;
        this.timeoutMs = opts.timeoutMs ?? 15_000;
    }

    private headers(): HeadersInit {
        return {
            "Content-Type": "application/json",
            "X-API-KEY": this.apiKey,
        };
    }

    private async request<T>(
        path: string,
        method: "GET" | "POST" | "DELETE",
        body?: unknown,
    ): Promise<T> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        let res: Response;
        try {
            res = await fetch(`${this.baseUrl}${path}`, {
                method,
                headers: this.headers(),
                body: body !== undefined ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timer);
        }

        if (!res.ok) {
            const text = await res.text().catch(() => "<unreadable>");
            throw new UnipileHttpError(res.status, method, path, text, res.headers);
        }

        const text = await res.text();
        if (!text) {
            return undefined as unknown as T;
        }

        try {
            return JSON.parse(text) as T;
        } catch {
            throw new Error(`[unipile] Invalid JSON raw response format received from ${path}`);
        }
    }

    private resolveProfileUrl(profile: LinkedInProfileRef): string {
        if (!profile.profileUrl) {
            throw new Error("[unipile] Unipile provider requires an explicit profileUrl.");
        }
        return profile.profileUrl;
    }

    private buildMetadata(account: LinkedInAccountContext): { provider: "UNIPILE"; executedAt: Date; accountId: string; operationId: string } {
        return {
            provider: "UNIPILE",
            executedAt: new Date(),
            accountId: account.accountId,
            operationId: randomUUID(),
        };
    }

    private mapError(error: unknown): ProviderError {
        if (error instanceof Error && error.name === "AbortError") {
            return {
                code: "TIMEOUT" as ProviderErrorCode,
                message: "The request timed out before a response was received from Unipile.",
            };
        }

        const errorString = String(error);
        const systemErrorCode = (error as Record<string, unknown>)?.code;
        if (
            systemErrorCode === "ENOTFOUND" ||
            systemErrorCode === "ECONNRESET" ||
            systemErrorCode === "ECONNREFUSED" ||
            systemErrorCode === "ETIMEDOUT" ||
            errorString.includes("fetch failed") ||
            errorString.includes("network error")
        ) {
            return {
                code: "NETWORK_ERROR" as ProviderErrorCode,
                message: error instanceof Error ? error.message : errorString,
            };
        }

        if (error instanceof UnipileHttpError) {
            let code: ProviderErrorCode = "UNKNOWN";
            let retryAfterSeconds: number | undefined = undefined;
            const normalizedResponse = error.responseText.toLowerCase();

            switch (error.status) {
                case 401:
                case 403:
                    code = "AUTH_EXPIRED";
                    break;
                case 404:
                    code = "PROFILE_NOT_FOUND";
                    break;
                case 429:
                    code = "RATE_LIMIT";
                    if (error.headers) {
                        const rawRetry = error.headers.get("retry-after");
                        if (rawRetry) {
                            const parsedRetry = parseInt(rawRetry, 10);
                            retryAfterSeconds = isNaN(parsedRetry) ? 60 : parsedRetry;
                        }
                    }
                    if (!retryAfterSeconds) {
                        retryAfterSeconds = 60;
                    }
                    break;
                default:
                    if (normalizedResponse.includes("invitation limit")) {
                        code = "INVITATION_LIMIT";
                    } else if (normalizedResponse.includes("blocked") || normalizedResponse.includes("restricted")) {
                        code = "MESSAGE_BLOCKED";
                    }
                    break;
            }

            return { code, message: error.message, retryAfterSeconds };
        }

        return {
            code: "UNKNOWN",
            message: error instanceof Error ? error.message : errorString,
        };
    }

    private success<T>(metadata: ReturnType<typeof this.buildMetadata>, result: T): LinkedInOperationResult<T> {
        return {
            async: false,
            metadata,
            result,
        };
    }

    private failure(metadata: ReturnType<typeof this.buildMetadata>, error: unknown): LinkedInOperationResult<never> {
        return {
            async: false,
            metadata,
            error: this.mapError(error),
        };
    }

    private enforceUnsupportedCapability(capabilityName: string): never {
        throw new Error(`Capability ${capabilityName} not supported`);
    }

    async health(account: LinkedInAccountContext): Promise<ProviderHealth> {
        try {
            await this.request<UnipileAccountsResponse>("/api/v1/accounts", "GET");
            return {
                healthy: true,
                authenticated: true,
                provider: "UNIPILE",
                accountId: account.accountId,
                capabilities: [
                    "VISIT_PROFILE",
                    "CONNECT",
                    "MESSAGE",
                    "INMAIL",
                    "PROFILE_LOOKUP",
                ],
            };
        } catch (error) {
            return {
                healthy: false,
                authenticated: false,
                provider: "UNIPILE",
                accountId: account.accountId,
                capabilities: [],
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    async validateConfiguration(config: Record<string, unknown>): Promise<ConfigurationValidationResult> {
        const errors: string[] = [];
        if (!config.baseUrl || typeof config.baseUrl !== "string") {
            errors.push("Missing or invalid 'baseUrl'");
        } else {
            try {
                new URL(config.baseUrl);
            } catch {
                errors.push("Provided 'baseUrl' is not a valid structured URL.");
            }
        }
        if (!config.apiKey || typeof config.apiKey !== "string") {
            errors.push("Missing or invalid 'apiKey'");
        }
        return {
            valid: errors.length === 0,
            errors: errors.length > 0 ? errors : undefined,
        };
    }

    async searchPeople(
        account: LinkedInAccountContext,
        options: { queryUrl: string; cursor?: string },
    ): Promise<LinkedInSearchResult> {
        const res = await this.request<any>(
            `/api/v1/linkedin/search?account_id=${encodeURIComponent(account.accountId)}`,
            "POST",
            {
                url: options.queryUrl,
                cursor: options.cursor,
            },
        );

        const items = (res.items || []).map((item: any) => {
            const firstName = item.first_name || undefined;
            const lastName = item.last_name || undefined;
            const fullName = item.name || [firstName, lastName].filter(Boolean).join(" ").trim() || undefined;
            return {
                profileUrl: item.public_url || item.url,
                fullName,
                firstName,
                lastName,
                headline: item.headline || undefined,
                company: item.company || undefined,
                title: item.title || undefined,
                location: item.location || undefined,
            };
        });

        return {
            items,
            cursor: res.cursor || undefined,
        };
    }

    async getJobStatus<T>(
        _account: LinkedInAccountContext,
        _jobId: string,
    ): Promise<LinkedInJobStatus<T>> {
        this.enforceUnsupportedCapability("ASYNC_OPERATIONS");
    }

    async cancelJob(
        _account: LinkedInAccountContext,
        _jobId: string,
    ): Promise<boolean> {
        return false;
    }

    async visitProfile(
        account: LinkedInAccountContext,
        profile: LinkedInProfileRef,
        options?: LinkedInRequestOptions,
    ): Promise<LinkedInOperationResult<LinkedInVisitResult>> {
        const metadata = this.buildMetadata(account);
        try {
            const profileUrl = this.resolveProfileUrl(profile);
            if (options?.idempotencyKey) {
                logger.warn({ operationId: metadata.operationId, idempotencyKey: options.idempotencyKey }, "[unipile] Idempotency key tracking unsupported by raw provider; execution proceeding best-effort.");
            }

            await this.request<unknown>("/api/v1/linkedin/profiles/view", "POST", {
                account_id: account.accountId,
                linkedin_url: profileUrl,
            });
            logger.info({ operationId: metadata.operationId, profileUrl }, "[unipile] Profile visit complete");
            return this.success(metadata, { profile });
        } catch (error) {
            logger.warn({ operationId: metadata.operationId, profile, error: error instanceof Error ? error.message : String(error) }, "[unipile] visitProfile failed");
            return this.failure(metadata, error);
        }
    }

    async sendConnectionRequest(
        account: LinkedInAccountContext,
        profile: LinkedInProfileRef,
        note?: string,
        options?: LinkedInRequestOptions,
    ): Promise<LinkedInOperationResult<LinkedInConnectResult>> {
        const metadata = this.buildMetadata(account);
        try {
            const profileUrl = this.resolveProfileUrl(profile);
            const truncatedNote = note?.slice(0, 300);

            if (options?.idempotencyKey) {
                logger.warn({ operationId: metadata.operationId, idempotencyKey: options.idempotencyKey }, "[unipile] Idempotency key tracking unsupported by raw provider; execution proceeding best-effort.");
            }

            const res = await this.request<UnipileInviteResponse>(
                "/api/v1/linkedin/invitations",
                "POST",
                {
                    account_id: account.accountId,
                    linkedin_url: profileUrl,
                    message: truncatedNote ?? "",
                },
            );
            logger.info({ operationId: metadata.operationId, profileUrl, invitationId: res.id }, "[unipile] Connection request complete");
            return this.success(metadata, { invitationId: res.id });
        } catch (error) {
            logger.warn({ operationId: metadata.operationId, profile, error: error instanceof Error ? error.message : String(error) }, "[unipile] sendConnectionRequest failed");
            return this.failure(metadata, error);
        }
    }

    async withdrawConnectionRequest(
        account: LinkedInAccountContext,
        _profile: LinkedInProfileRef,
        _options?: LinkedInRequestOptions,
    ): Promise<LinkedInOperationResult<{ success: boolean }>> {
        const metadata = this.buildMetadata(account);
        return this.failure(metadata, new Error("Capability WITHDRAW_CONNECT not supported"));
    }

    async sendMessage(
        account: LinkedInAccountContext,
        profile: LinkedInProfileRef,
        content: LinkedInMessageContent,
        options?: LinkedInRequestOptions,
    ): Promise<LinkedInOperationResult<LinkedInMessageResult>> {
        const metadata = this.buildMetadata(account);
        try {
            const profileUrl = this.resolveProfileUrl(profile);
            if (options?.idempotencyKey) {
                logger.warn({ operationId: metadata.operationId, idempotencyKey: options.idempotencyKey }, "[unipile] Idempotency key tracking unsupported by raw provider; execution proceeding best-effort.");
            }

            const res = await this.request<UnipileMessageResponse>(
                "/api/v1/messaging/messages",
                "POST",
                {
                    account_id: account.accountId,
                    linkedin_url: profileUrl,
                    text: content.text,
                    type: "linkedin_message",
                },
            );
            logger.info({ operationId: metadata.operationId, profileUrl, messageId: res.id }, "[unipile] Message complete");
            return this.success(metadata, { messageId: res.id });
        } catch (error) {
            logger.warn({ operationId: metadata.operationId, profile, error: error instanceof Error ? error.message : String(error) }, "[unipile] sendMessage failed");
            return this.failure(metadata, error);
        }
    }

    async sendInMail(
        account: LinkedInAccountContext,
        profile: LinkedInProfileRef,
        subject: string,
        content: LinkedInMessageContent,
        options?: LinkedInRequestOptions,
    ): Promise<LinkedInOperationResult<LinkedInMessageResult>> {
        const metadata = this.buildMetadata(account);
        try {
            const profileUrl = this.resolveProfileUrl(profile);
            if (options?.idempotencyKey) {
                logger.warn({ operationId: metadata.operationId, idempotencyKey: options.idempotencyKey }, "[unipile] Idempotency key tracking unsupported by raw provider; execution proceeding best-effort.");
            }

            const res = await this.request<UnipileMessageResponse>(
                "/api/v1/messaging/messages",
                "POST",
                {
                    account_id: account.accountId,
                    linkedin_url: profileUrl,
                    subject,
                    text: content.text,
                    type: "linkedin_inmail",
                },
            );
            logger.info({ operationId: metadata.operationId, profileUrl, messageId: res.id }, "[unipile] InMail complete");
            return this.success(metadata, { messageId: res.id });
        } catch (error) {
            logger.warn({ operationId: metadata.operationId, profile, error: error instanceof Error ? error.message : String(error) }, "[unipile] sendInMail failed");
            return this.failure(metadata, error);
        }
    }

    async checkConnectionStatus(
        account: LinkedInAccountContext,
        profile: LinkedInProfileRef,
    ): Promise<LinkedInConnectionStatus> {
        try {
            const profileUrl = this.resolveProfileUrl(profile);
            const res = await this.request<UnipileRelationResponse>(
                "/api/v1/linkedin/profiles/relation",
                "POST",
                {
                    account_id: account.accountId,
                    linkedin_url: profileUrl,
                },
            );
            return {
                connected: res.status === "CONNECTED",
                pending: res.status === "PENDING_SENT",
            };
        } catch (error) {
            logger.warn({ profile, error: error instanceof Error ? error.message : String(error) }, "[unipile] checkConnectionStatus failed");
            return { connected: false, pending: false };
        }
    }

    async getProfile(
        account: LinkedInAccountContext,
        profile: LinkedInProfileRef,
    ): Promise<LinkedInProfile> {
        const profileUrl = this.resolveProfileUrl(profile);
        const res = await this.request<UnipileProfileResponse>(
            // Fix 10: URL-encode account_id — Unipile account IDs may contain characters
            // unsafe in query strings (e.g. spaces or OAuth-derived special chars).
            `/api/v1/linkedin/profiles?account_id=${encodeURIComponent(account.accountId)}&linkedin_url=${encodeURIComponent(profileUrl)}`,
            "GET",
        );

        const derivedFullName = [res.first_name, res.last_name].filter(Boolean).join(" ").trim();

        return {
            profileUrl: res.public_url || profileUrl,
            firstName: res.first_name || undefined,
            lastName: res.last_name || undefined,
            fullName: derivedFullName || "LinkedIn Member",
            headline: res.headline || undefined,
            company: res.company || undefined,
            title: res.title || undefined,
            location: res.location || undefined,
            summary: res.summary || undefined,
            connectionsCount: res.connections_count ?? undefined,
            avatarUrl: res.avatar_url || undefined,
        };
    }

    async listConversations(
        _account: LinkedInAccountContext,
        _options?: { cursor?: string; limit?: number },
    ): Promise<PaginatedConversationList> {
        this.enforceUnsupportedCapability("LIST_CONVERSATIONS");
    }

    async getConversation(
        _account: LinkedInAccountContext,
        _profile: LinkedInProfileRef,
        _options?: { cursor?: string; limit?: number },
    ): Promise<PaginatedConversation> {
        this.enforceUnsupportedCapability("MESSAGE_HISTORY");
    }

    async getActivity(
        _account: LinkedInAccountContext,
        _profile: LinkedInProfileRef,
        _options?: { startTime?: Date; limit?: number },
    ): Promise<LinkedInActivity[]> {
        this.enforceUnsupportedCapability("REALTIME_EVENTS");
    }

    async canContact(
        account: LinkedInAccountContext,
        profile: LinkedInProfileRef,
    ): Promise<{ allowed: boolean; reason?: ContactRestrictionReason }> {
        const status = await this.checkConnectionStatus(account, profile);
        if (status.connected) {
            return { allowed: false, reason: "ALREADY_CONNECTED" };
        }
        if (status.pending) {
            return { allowed: false, reason: "PENDING_REQUEST" };
        }
        return { allowed: true };
    }

    async handleWebhook(
        _payload: Record<string, unknown>,
        _signature?: string,
    ): Promise<WebhookProcessingResult> {
        return { verified: false, error: "Capability REALTIME_EVENTS not supported" };
    }
}