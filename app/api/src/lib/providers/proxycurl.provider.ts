import { logger } from "../logger";
import { CompanyEnrichResult, PersonEnrichResult, EnrichmentProvider } from "./types";

const TIMEOUT_MS = 10000;
const PROXYCURL_BASE = "https://nubela.co/api/v1/linkedin";

async function pcGet(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${PROXYCURL_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${process.env.PROXYCURL_API_KEY}`,
      },
      signal: controller.signal,
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Proxycurl ${path} → ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

export class ProxycurlProvider implements EnrichmentProvider {
  readonly name = "proxycurl";
  readonly priority = 3;

  async enrichCompany(_domain: string): Promise<CompanyEnrichResult | null> {
    return null;
  }

  async enrichPerson(params: {
    email?: string;
    linkedinUrl?: string;
    firstName?: string;
    lastName?: string;
    domain?: string;
  }): Promise<PersonEnrichResult | null> {
    if (!process.env.PROXYCURL_API_KEY || !params.linkedinUrl) return null;
    try {
      const response = await pcGet("", {
        linkedin_profile_url: params.linkedinUrl,
        extra: "include",
        personal_email: "include",
        personal_contact_number: "include",
      });
      if (!response) return null;
      const data = response as Record<string, any>;
      const latestExp = Array.isArray(data.experiences)
        ? (data.experiences as any[]).find((e: any) => !e.ends_at)
        : undefined;
      return {
        firstName: data.first_name ?? undefined,
        lastName: data.last_name ?? undefined,
        title: data.occupation ?? latestExp?.title ?? undefined,
        department: latestExp?.company ?? undefined,
        linkedinUrl: params.linkedinUrl,
        email: (Array.isArray(data.personal_emails) ? data.personal_emails[0] : undefined) ?? data.work_email ?? undefined,
        phone: Array.isArray(data.personal_numbers) ? data.personal_numbers[0] : undefined,
        source: "proxycurl",
      };
    } catch (err) {
      logger.warn({ linkedinUrl: params.linkedinUrl, err }, "[proxycurl] enrichPerson failed");
      return null;
    }
  }
}
