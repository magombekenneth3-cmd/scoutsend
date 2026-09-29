import { logger } from "../logger";
import { ApiKeyVault } from "../key-manager";
import { CompanyEnrichResult, PersonEnrichResult, EnrichmentProvider } from "./types";

const TIMEOUT_MS = 10000;
const hunterVault = new ApiKeyVault("hunter-provider", "HUNTER_API_KEYS");

export class HunterProvider implements EnrichmentProvider {
  readonly name = "hunter";
  readonly priority = 3;

  async enrichCompany(domain: string): Promise<CompanyEnrichResult | null> {
    let key: string;
    try {
      key = await hunterVault.acquireKey();
    } catch {
      return null;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const url = new URL("https://api.hunter.io/v2/domain-search");
      url.searchParams.set("domain", domain);
      url.searchParams.set("api_key", key);

      const res = await fetch(url.toString(), {
        signal: controller.signal,
      });

      if (res.status === 429 || res.status === 401 || res.status === 402 || res.status === 403) {
        await hunterVault.reportFailure(key, res.status);
        return null;
      }
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Hunter domain search → ${res.status}`);

      const data = (await res.json()) as { data?: Record<string, any> };
      const d = data.data;
      if (!d) return null;

      return {
        name: d.organization ?? undefined,
        domain: d.domain ?? domain,
        industry: d.industry ?? undefined,
        description: d.description ?? undefined,
        country: d.country ?? undefined,
        linkedinUrl: d.linkedin ?? undefined,
        techStack: Array.isArray(d.technologies) ? d.technologies : undefined,
        source: "hunter",
      };
    } catch (err) {
      logger.warn({ domain, err }, "[hunter-provider] enrichCompany failed");
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async enrichPerson(params: {
    email?: string;
    linkedinUrl?: string;
    firstName?: string;
    lastName?: string;
    domain?: string;
  }): Promise<PersonEnrichResult | null> {
    if (!params.domain || (!params.firstName && !params.lastName)) {
      return null;
    }

    let key: string;
    try {
      key = await hunterVault.acquireKey();
    } catch {
      return null;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const url = new URL("https://api.hunter.io/v2/email-finder");
      url.searchParams.set("domain", params.domain);
      if (params.firstName) url.searchParams.set("first_name", params.firstName);
      if (params.lastName) url.searchParams.set("last_name", params.lastName);
      url.searchParams.set("api_key", key);

      const res = await fetch(url.toString(), {
        signal: controller.signal,
      });

      if (res.status === 429 || res.status === 401 || res.status === 402 || res.status === 403) {
        await hunterVault.reportFailure(key, res.status);
        return null;
      }
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Hunter email finder → ${res.status}`);

      const data = (await res.json()) as { data?: Record<string, any> };
      const d = data.data;
      if (!d || !d.email) return null;

      return {
        firstName: d.first_name ?? params.firstName,
        lastName: d.last_name ?? params.lastName,
        email: d.email,
        title: d.position ?? undefined,
        linkedinUrl: d.linkedin ?? params.linkedinUrl,
        source: "hunter",
      };
    } catch (err) {
      logger.warn({ params, err }, "[hunter-provider] enrichPerson failed");
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
