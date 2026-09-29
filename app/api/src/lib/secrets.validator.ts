const PLACEHOLDER_PATTERNS = [
    /^placeholder/i,
    /placeholder$/i,
    /dev_placeholder/i,
    /^whsec_dev/i,
    /^hhkk/i,
    /^your[_-]/i,
    /^xxx+/i,
    /^re_xxx/i,
    /^fe_oa_/i,
    /^unipile_(webhook|test)_/i,
    /^hunter_api_key_/i,
    /^zerobounce_api_key_/i,
    /\.com\.com/,
    /^ww\./i,
];

const HARD_FAIL_KEYS: string[] = ["JWT_SECRET", "MAILBOX_ENCRYPTION_KEY"];

const WARN_KEYS: string[] = [
    "WEBHOOK_SECRET",
    "RESEND_WEBHOOK_SECRET",
    "UNIPILE_API_KEY",
    "UNIPILE_BASE_URL",
    "INBOUND_LEAD_SECRET",
    "UNIPILE_WEBHOOK_SECRET",
    // Booking link — if missing or expired, reply agents can't insert a call link
    "CALENDLY_URL",
    // Error monitoring — silent in production without this
    "SENTRY_DSN",
    // Health endpoint secret — exposes infra topology if not set
    "HEALTH_CHECK_SECRET",
];

const MIN_ENTROPY_KEYS: Record<string, number> = {
    JWT_SECRET: 32,
    MAILBOX_ENCRYPTION_KEY: 32,
};

function isPlaceholder(value: string): boolean {
    return PLACEHOLDER_PATTERNS.some((re) => re.test(value));
}

function hasMinEntropy(key: string, value: string): boolean {
    const min = MIN_ENTROPY_KEYS[key];
    if (!min) return true;
    const hex = value.replace(/[^0-9a-fA-F]/g, "");
    return hex.length >= min * 2 || value.length >= min;
}

export function validateSecrets(): void {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const key of HARD_FAIL_KEYS) {
        const val = process.env[key];
        if (!val) {
            errors.push(`${key} is not set`);
            continue;
        }
        if (isPlaceholder(val)) {
            errors.push(`${key} appears to be a placeholder value — must be replaced before running in production`);
            continue;
        }
        if (!hasMinEntropy(key, val)) {
            errors.push(`${key} is too short — minimum 32 random bytes required`);
        }
    }

    for (const key of WARN_KEYS) {
        const val = process.env[key];
        if (!val || isPlaceholder(val)) {
            warnings.push(`${key} is missing or appears to be a placeholder — related features will be disabled`);
        }
    }

    for (const w of warnings) {
        console.warn(`[secrets] WARN: ${w}`);
    }

    if (errors.length > 0) {
        for (const e of errors) {
            console.error(`[secrets] FATAL: ${e}`);
        }
        console.error("[secrets] Fix the above critical secrets before starting the server.");
        process.exit(1);
    }
}
