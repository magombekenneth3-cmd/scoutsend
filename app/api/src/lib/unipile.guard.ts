import { ServiceUnavailableError } from "./errors";

const PLACEHOLDER_API_KEY_RE = /^hhkk|^placeholder|^xxx|^your_/i;
const PLACEHOLDER_URL_RE = /\.com\.com|^https?:\/\/ww\.|placeholder/i;

export function isUnipileConfigured(): boolean {
    const apiKey = process.env.UNIPILE_API_KEY ?? "";
    const baseUrl = process.env.UNIPILE_BASE_URL ?? "";
    if (!apiKey || PLACEHOLDER_API_KEY_RE.test(apiKey)) return false;
    if (!baseUrl || PLACEHOLDER_URL_RE.test(baseUrl)) return false;
    return true;
}

export function assertUnipileConfigured(): void {
    if (!isUnipileConfigured()) {
        throw new ServiceUnavailableError(
            "LinkedIn integration is not configured: UNIPILE_API_KEY or UNIPILE_BASE_URL is missing or invalid. " +
            "Set valid Unipile credentials to enable LinkedIn outreach."
        );
    }
}
