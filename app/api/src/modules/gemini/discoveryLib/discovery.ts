import { Prisma } from "@prisma/client";
import { ATS_DOMAINS, SOURCE_WEIGHTS, DEFAULT_SOURCE_WEIGHT } from "./discovery.constants";

export function emailToDomain(email: string): string | null {
    const host = email.split("@")[1]?.toLowerCase();
    if (!host) return null;
    const parts = host.split(".");
    if (parts.length > 2 && ["mail", "smtp", "email", "m"].includes(parts[0])) {
        return parts.slice(1).join(".");
    }
    return host;
}

export function normaliseName(value: string | undefined): string {
    return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function isAtsUrl(url: string): boolean {
    try {
        const hostname = new URL(url).hostname.replace(/^www\./, "");
        return ATS_DOMAINS.has(hostname);
    } catch {
        return false;
    }
}

export function computeWeightedScore(rawConfidence: number, source: string): number {
    const weight = SOURCE_WEIGHTS[source] ?? DEFAULT_SOURCE_WEIGHT;
    return Math.round(rawConfidence * weight * 1000) / 1000;
}

export function sourceWeight(source: string): number {
    return SOURCE_WEIGHTS[source] ?? DEFAULT_SOURCE_WEIGHT;
}

export function isPrismaUniqueViolation(err: unknown): boolean {
    return (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
    );
}

export function icpHash(value: string): string {
    return Buffer.from(value).toString("base64").slice(0, 64);
}