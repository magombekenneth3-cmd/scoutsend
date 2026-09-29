import { logger } from "../logger";
import { ApiKeyVault } from "../key-manager";
import { CompanyEnrichResult, PersonEnrichResult, EnrichmentProvider } from "./types";

const TIMEOUT_MS = 10000;
const apolloVault = new ApiKeyVault("apollo-provider", "APOLLO_API_KEYS");

export class ApolloProvider implements EnrichmentProvider {
  readonly name = "apollo";
  readonly priority = 1;

  async enrichCompany(domain: string): Promise<CompanyEnrichResult | null> {
    let key: string;
    try {
      key = await apolloVault.acquireKey();
    } catch {
      return null;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch("https://api.apollo.io/api/v1/organizations/enrich", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": key,
        },
        body: JSON.stringify({ domain }),
        signal: controller.signal,
      });

      if (res.status === 429 || res.status === 401 || res.status === 402 || res.status === 403) {
        await apolloVault.reportFailure(key, res.status);
        return null;
      }
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Apollo company enrich → ${res.status}`);

      const data = (await res.json()) as { organization?: Record<string, any> };
      const org = data.organization;
      if (!org) return null;

      return {
        name: org.name ?? undefined,
        domain: org.primary_domain ?? domain,
        industry: org.industry ?? undefined,
        employeeCount: typeof org.estimated_num_employees === "number" ? org.estimated_num_employees : undefined,
        foundedYear: typeof org.founded_year === "number" ? org.founded_year : undefined,
        description: org.short_description ?? undefined,
        linkedinUrl: org.linkedin_url ?? undefined,
        country: org.country ?? undefined,
        techStack: Array.isArray(org.technology_names) ? org.technology_names : undefined,
        fundingTotalUsd: typeof org.total_funding === "number" ? org.total_funding : undefined,
        source: "apollo",
      };
    } catch (err) {
      logger.warn({ domain, err }, "[apollo-provider] enrichCompany failed");
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
    if (!params.email && !params.linkedinUrl && (!params.firstName || !params.lastName || !params.domain)) {
      return null;
    }

    let key: string;
    try {
      key = await apolloVault.acquireKey();
    } catch {
      return null;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const body: Record<string, unknown> = {
        reveal_personal_emails: false,
      };
      if (params.email) body.email = params.email;
      if (params.firstName) body.first_name = params.firstName;
      if (params.lastName) body.last_name = params.lastName;
      if (params.domain) body.domain = params.domain;

      const res = await fetch("https://api.apollo.io/api/v1/people/match", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": key,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (res.status === 429 || res.status === 401 || res.status === 402 || res.status === 403) {
        await apolloVault.reportFailure(key, res.status);
        return null;
      }
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Apollo person match → ${res.status}`);

      const data = (await res.json()) as { person?: Record<string, any> };
      const person = data.person;
      if (!person) return null;

      return {
        firstName: person.first_name ?? params.firstName,
        lastName: person.last_name ?? params.lastName,
        email: person.email ?? params.email,
        title: person.title ?? undefined,
        seniority: person.seniority ?? undefined,
        department: Array.isArray(person.departments) ? person.departments[0] : undefined,
        linkedinUrl: person.linkedin_url ?? params.linkedinUrl,
        phone: person.sanitized_phone_number ?? undefined,
        source: "apollo",
      };
    } catch (err) {
      logger.warn({ params, err }, "[apollo-provider] enrichPerson failed");
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
