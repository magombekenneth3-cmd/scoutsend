import { randomBytes, createHash } from "crypto";
import { prisma } from "../../lib/prisma";
import { NotFoundError, ForbiddenError } from "../../lib/errors";

const KEY_BYTES = 32;
const KEY_PREFIX_LENGTH = 8;
const PREFIX_HEADER = "ak_";

function generateKey(): { plaintext: string; hash: string; prefix: string } {
    const raw = randomBytes(KEY_BYTES).toString("hex");
    const plaintext = `${PREFIX_HEADER}${raw}`;
    const hash = createHash("sha256").update(plaintext).digest("hex");
    const prefix = `${PREFIX_HEADER}${raw.slice(0, KEY_PREFIX_LENGTH)}`;
    return { plaintext, hash, prefix };
}

export async function createApiKey(orgId: string, name: string, scopes: string[] = ["inbound:lead"]) {
    const { plaintext, hash, prefix } = generateKey();
    const key = await prisma.apiKey.create({
        data: { orgId, name, keyHash: hash, keyPrefix: prefix, scopes },
        select: { id: true, name: true, keyPrefix: true, scopes: true, createdAt: true },
    });
    return { ...key, key: plaintext };
}

export async function listApiKeys(orgId: string) {
    return prisma.apiKey.findMany({
        where: { orgId, revokedAt: null },
        select: { id: true, name: true, keyPrefix: true, scopes: true, lastUsedAt: true, createdAt: true },
        orderBy: { createdAt: "desc" },
    });
}

export async function revokeApiKey(id: string, orgId: string) {
    const key = await prisma.apiKey.findFirst({ where: { id, orgId } });
    if (!key) throw new NotFoundError("ApiKey");
    await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
}

export async function validateApiKey(
    plaintext: string,
    requiredScope: string
): Promise<{ orgId: string } | null> {
    const hash = createHash("sha256").update(plaintext).digest("hex");
    const key = await prisma.apiKey.findUnique({
        where: { keyHash: hash },
        select: { id: true, orgId: true, scopes: true, revokedAt: true },
    });
    if (!key || key.revokedAt) return null;
    if (!key.scopes.includes(requiredScope) && !key.scopes.includes("*")) return null;

    prisma.apiKey.update({
        where: { id: key.id },
        data: { lastUsedAt: new Date() },
    }).catch(() => {});

    return { orgId: key.orgId };
}
