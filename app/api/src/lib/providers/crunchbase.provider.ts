import { logger } from "../logger";
import { CompanyEnrichResult, PersonEnrichResult, EnrichmentProvider } from "./types";

const TIMEOUT_MS = 10000;
const CRUNCHBASE_BASE = "https://api.crunchbase.com/api/v4";
const FIELD_IDS = "short_description,funding_total,founded_on,categories,num_employees_enum,location_identifiers";

const EMPLOYEE_BAND: Record<string, number> = {
  "c_00001_00010": 5,
  "c_00011_00050": 30,
  "c_00051_00100": 75,
  "c_00101_00250": 175,
  "c_00251_00500": 375,
  "c_00501_01000": 750,
  "c_01001_05000": 3000,
  "c_05001_10000": 7500,
  "c_10001_max": 15000,
};

async function cbGet(path: string): Promise<unknown> {
  const url = new URL(`${CRUNCHBASE_BASE}${path}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: {
        "X-Cb-User-Key": process.env.CRUNCHBASE_API_KEY!,
      },
      signal: controller.signal,
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Crunchbase GET ${path} → ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function resolvePermalink(domain: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = new URL(`${CRUNCHBASE_BASE}/autocomplete`);
    url.searchParams.set("query", domain);
    url.searchParams.set("collection_ids", "organizations");
    url.searchParams.set("limit", "1");
    const res = await fetch(url.toString(), {
      headers: { "X-Cb-User-Key": process.env.CRUNCHBASE_API_KEY! },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      entities?: { identifier?: { permalink?: string } }[];
    };
    return data.entities?.[0]?.identifier?.permalink ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export class CrunchbaseProvider implements EnrichmentProvider {
  readonly name = "crunchbase";
  readonly priority = 4;

  async enrichCompany(domain: string): Promise<CompanyEnrichResult | null> {
    if (!process.env.CRUNCHBASE_API_KEY) return null;
    try {
      const permalink = await resolvePermalink(domain);
      if (!permalink) return null;
      const response = await cbGet(`/entities/organizations/${permalink}?field_ids=${FIELD_IDS}`);
      if (!response) return null;
      const data = response as { properties?: Record<string, any> };
      if (!data.properties) return null;
      const p = data.properties;
      const funding = p.funding_total?.value_usd;
      const empBand = p.num_employees_enum as string | undefined;
      const country = (p.location_identifiers as any[] | undefined)?.find(
        (l: any) => l.location_type === "country"
      )?.value;
      return {
        description: p.short_description ?? undefined,
        fundingTotalUsd: typeof funding === "number" ? funding : undefined,
        foundedYear: p.founded_on?.year ?? undefined,
        industry: (p.categories as any[] | undefined)?.[0]?.value ?? undefined,
        employeeCount: empBand ? EMPLOYEE_BAND[empBand] : undefined,
        country: country ?? undefined,
        source: "crunchbase",
      };
    } catch (err) {
      logger.warn({ domain, err }, "[crunchbase] enrichCompany failed");
      return null;
    }
  }

  async enrichPerson(): Promise<PersonEnrichResult | null> {
    return null;
  }
}
