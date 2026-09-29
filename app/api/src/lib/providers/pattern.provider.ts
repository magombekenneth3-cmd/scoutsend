import { CompanyEnrichResult, PersonEnrichResult, EnrichmentProvider } from "./types";

export class PatternProvider implements EnrichmentProvider {
  readonly name = "pattern_fallback";
  readonly priority = 99; // Fallback after API providers

  async enrichCompany(): Promise<CompanyEnrichResult | null> {
    return null;
  }

  async enrichPerson(params: {
    email?: string;
    linkedinUrl?: string;
    firstName?: string;
    lastName?: string;
    domain?: string;
  }): Promise<PersonEnrichResult | null> {
    if (params.email) {
      return {
        firstName: params.firstName,
        lastName: params.lastName,
        email: params.email,
        linkedinUrl: params.linkedinUrl,
        source: "pattern_fallback",
      };
    }

    if (params.firstName && params.lastName && params.domain) {
      const cleanFirst = params.firstName.toLowerCase().replace(/[^a-z0-9]/g, "");
      const cleanLast = params.lastName.toLowerCase().replace(/[^a-z0-9]/g, "");
      const cleanDomain = params.domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];

      if (cleanFirst && cleanLast && cleanDomain) {
        return {
          firstName: params.firstName,
          lastName: params.lastName,
          email: `${cleanFirst}.${cleanLast}@${cleanDomain}`,
          linkedinUrl: params.linkedinUrl,
          source: "pattern_fallback",
        };
      }
    }

    return null;
  }
}
