import { logger } from "../logger";
import { CompanyEnrichResult, PersonEnrichResult, EnrichmentProvider } from "./types";

const TIMEOUT_MS = 10000;
const PDL_BASE = "https://api.peopledatalabs.com/v5";

async function pdlPost(path: string, body: object): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${PDL_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": process.env.PDL_API_KEY!,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (res.status === 404 || res.status === 402) return null;
    if (!res.ok) throw new Error(`PDL ${path} → ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

function inferSeniority(title?: string): string | undefined {
  if (!title) return undefined;
  const t = title.toLowerCase();
  if (t.includes("owner") || t.includes("founder") || t.includes("co-founder") || t.includes("cofounder")) return "Founder";
  if (t.includes("chief") || t.includes("cxo") || t.startsWith("c") && t.endsWith("o") || t.includes("ceo") || t.includes("cto") || t.includes("cfo") || t.includes("cmo") || t.includes("cro") || t.includes("cpo")) return "C-Level";
  if (t.includes("vp ") || t.includes(" vp") || t === "vp" || t.includes("vice president")) return "VP";
  if (t.includes("director")) return "Director";
  if (t.includes("manager") || t.includes("head") || t.includes("lead")) return "Manager";
  return "Individual Contributor";
}

export class PDLProvider implements EnrichmentProvider {
  readonly name = "pdl";
  readonly priority = 2;

  async enrichCompany(domain: string): Promise<CompanyEnrichResult | null> {
    if (!process.env.PDL_API_KEY) return null;
    try {
      const response = await pdlPost("/company/enrich", {
        params: { website: domain },
      });
      if (!response) return null;
      const data = response as Record<string, any>;
      return {
        name: data.name ?? undefined,
        domain: data.website ?? undefined,
        industry: data.industry ?? undefined,
        employeeCount: typeof data.employee_count === "number" ? data.employee_count : undefined,
        foundedYear: typeof data.founded === "number" ? data.founded : undefined,
        description: data.summary ?? undefined,
        linkedinUrl: data.linkedin_url ?? undefined,
        country: data.location?.country ?? undefined,
        techStack: Array.isArray(data.technologies)
          ? data.technologies.map((t: any) => typeof t === "string" ? t : t?.name).filter(Boolean)
          : undefined,
        fundingTotalUsd: typeof data.total_funding_raised === "number" ? data.total_funding_raised : undefined,
        source: "pdl",
      };
    } catch (err) {
      logger.warn({ domain, err }, "[pdl] enrichCompany failed");
      return null;
    }
  }

  async enrichPerson(params: {
    email?: string;
    linkedinUrl?: string;
    firstName?: string;
    lastName?: string;
    domain?: string;
  }): Promise<PersonEnrichResult | null> {
    if (!process.env.PDL_API_KEY) return null;
    const query: Record<string, string> = {};
    if (params.email) query.email = params.email;
    if (params.linkedinUrl) query.profile = params.linkedinUrl;
    if (params.firstName) query.first_name = params.firstName;
    if (params.lastName) query.last_name = params.lastName;
    if (params.domain) query.company = params.domain;
    if (Object.keys(query).length === 0) return null;
    try {
      const response = await pdlPost("/person/enrich", { params: query });
      if (!response) return null;
      const data = response as Record<string, any>;
      const email = data.work_email ?? (Array.isArray(data.emails) ? data.emails[0]?.address : undefined);
      return {
        firstName: data.first_name ?? undefined,
        lastName: data.last_name ?? undefined,
        email: typeof email === "string" ? email : undefined,
        title: data.job_title ?? undefined,
        seniority: inferSeniority(data.job_title),
        department: data.job_company_industry ?? undefined,
        linkedinUrl: data.linkedin_url ?? undefined,
        phone: data.mobile_phone ?? undefined,
        source: "pdl",
      };
    } catch (err) {
      logger.warn({ err }, "[pdl] enrichPerson failed");
      return null;
    }
  }
}
