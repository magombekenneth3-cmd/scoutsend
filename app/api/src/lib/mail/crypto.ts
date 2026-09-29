import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
    const hex = process.env.MAILBOX_ENCRYPTION_KEY;
    if (!hex || hex.length !== 64) {
        throw new Error(
            "MAILBOX_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). " +
            'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
        );
    }
    return Buffer.from(hex, "hex");
}

export function encryptJson(value: unknown): string {
    const key = getKey();
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const plaintext = JSON.stringify(value);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, encrypted, tag]).toString("base64url");
}

export function decryptJson<T = unknown>(encoded: string): T {
    const key = getKey();
    const envelope = Buffer.from(encoded, "base64url");

    if (envelope.length < IV_LEN + TAG_LEN + 1) {
        throw new Error("Encrypted credential blob is too short — data may be corrupt");
    }

    const iv = envelope.subarray(0, IV_LEN);
    const tag = envelope.subarray(envelope.length - TAG_LEN);
    const ciphertext = envelope.subarray(IV_LEN, envelope.length - TAG_LEN);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = decipher.update(ciphertext, undefined, "utf8") + decipher.final("utf8");
    return JSON.parse(decrypted) as T;
}

export function isEncrypted(value: unknown): value is string {
    return typeof value === "string";
}

export function encrypt(value: string): string {
    const key = getKey();
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, encrypted, tag]).toString("base64url");
}

export function decrypt(encoded: string): string {
    const key = getKey();
    const envelope = Buffer.from(encoded, "base64url");
    if (envelope.length < IV_LEN + TAG_LEN + 1) {
        throw new Error("Encrypted token blob is too short — data may be corrupt");
    }
    const iv = envelope.subarray(0, IV_LEN);
    const tag = envelope.subarray(envelope.length - TAG_LEN);
    const ciphertext = envelope.subarray(IV_LEN, envelope.length - TAG_LEN);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext, undefined, "utf8") + decipher.final("utf8");
}

export function decryptMailboxCredentials<T = unknown>(raw: unknown, context?: string): T {
    if (typeof raw !== "string") {
        const ctx = context ? ` [context: ${context}]` : "";
        throw new Error(
            `Mailbox credentials are stored in plaintext — encryption migration required.${ctx} ` +
            "Run the credentials migration script to re-encrypt all legacy records before restarting."
        );
    }
    return decryptJson<T>(raw);
}