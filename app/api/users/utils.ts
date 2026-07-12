import { headers } from "next/headers";

export async function getClientIp(): Promise<string | undefined> {
    const store = await headers();
    const forwardedFor = store.get("x-forwarded-for");
    if (forwardedFor) return forwardedFor.split(",")[0].trim();
    return store.get("x-real-ip") ?? undefined;
}