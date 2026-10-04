import { Router } from "express";
import dns from "dns";
import { EmailStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { apolloPeopleSearchMultiPage } from "../gemini/discoveryLib/Apollo.provider";
import { callGemini, MODELS, parseSafeJson } from "../gemini/gemini.client";
import { authMiddleware } from "../auth/auth.middleware";
import { AuthenticatedRequest } from "../auth/auth.types";
import { searchSerpPeople } from "../../lib/prospect-discovery/serp-people-search";
import { resolveEmailForProspect } from "../../lib/prospect-discovery/email-reveal";
import { isRealPerson } from "../../lib/prospect-discovery/shared";
import { logger } from "../../lib/logger";

const router = Router();

router.use(authMiddleware);

const PLACEHOLDER_DOMAINS = new Set([
  "domain.com",
  "company.com",
  "example.com",
  "test.com",
  "unverified.local",
  "email.com",
  "mail.com",
  "placeholder.com",
]);

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "tempmail.com",
  "throwam.com",
  "yopmail.com",
  "sharklasers.com",
  "guerrillamailblock.com",
  "grr.la",
  "guerrillamail.info",
  "trashmail.com",
  "dispostable.com",
  "fakeinbox.com",
  "mailnull.com",
  "spamgourmet.com",
  "maildrop.cc",
  "getairmail.com",
]);

const ROLE_ACCOUNT_PREFIXES = new Set([
  "contact",
  "info",
  "sales",
  "hello",
  "admin",
  "support",
  "office",
  "billing",
  "jobs",
  "careers",
  "help",
  "enquiries",
  "inquiries",
  "media",
  "press",
  "noreply",
  "no-reply",
  "donotreply",
  "team",
  "marketing",
  "hr",
  "legal",
  "privacy",
  "security",
  "abuse",
]);

const FORBIDDEN_NAMES = new Set([
  "prospect",
  "unknown",
  "person",
  "contact",
  "user",
  "lead",
  "profile",
  "member",
  "company",
  "business",
  "corporation",
  "inc",
  "ltd",
  "llc",
  "decision maker",
]);

const EMAIL_PATTERN =
  /\b[a-zA-Z0-9][a-zA-Z0-9._%+-]{1,63}@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+\b/g;

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;

  const normalized = email
    .trim()
    .toLowerCase()
    .replace(/^mailto:/i, "")
    .replace(/[),.;:'"]+$/g, "");

  return isValidEmailCandidate(normalized) ? normalized : null;
}

function normalizeDomain(value: unknown): string {
  if (typeof value !== "string") return "";

  const input = value.trim();
  if (!input) return "";

  try {
    const hostname = new URL(
      input.startsWith("http://") || input.startsWith("https://")
        ? input
        : `https://${input}`,
    )
      .hostname
      .replace(/^www\./i, "")
      .toLowerCase();

    if (
      !hostname ||
      PLACEHOLDER_DOMAINS.has(hostname) ||
      DISPOSABLE_DOMAINS.has(hostname) ||
      !hostname.includes(".")
    ) {
      return "";
    }

    return hostname;
  } catch {
    return "";
  }
}

function isValidEmailCandidate(email: string): boolean {
  if (!email || !email.includes("@")) return false;

  const parts = email.split("@");
  if (parts.length !== 2) return false;

  const [prefix, domain] = parts;

  if (!prefix || !domain) return false;
  if (prefix.length < 2 || prefix.length > 64) return false;
  if (domain.length < 4 || domain.length > 255) return false;
  if (ROLE_ACCOUNT_PREFIXES.has(prefix.toLowerCase())) return false;
  if (DISPOSABLE_DOMAINS.has(domain.toLowerCase())) return false;
  if (PLACEHOLDER_DOMAINS.has(domain.toLowerCase())) return false;
  if (!/^[a-z0-9._%+-]+$/i.test(prefix)) return false;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return false;
  if (domain.startsWith(".") || domain.endsWith(".")) return false;
  if (domain.includes("..")) return false;

  return true;
}

function isStrongPersonRecord(
  firstName: string,
  lastName: string,
  companyName: string,
  title: string,
): boolean {
  const fn = normalizeText(firstName).toLowerCase();
  const ln = normalizeText(lastName).toLowerCase();
  const cn = normalizeText(companyName).toLowerCase();
  const tt = normalizeText(title).toLowerCase();

  if (!fn || fn.length < 2 || FORBIDDEN_NAMES.has(fn)) return false;
  if (!cn || cn.length < 2 || FORBIDDEN_NAMES.has(cn)) return false;
  if (!tt || tt.length < 2 || FORBIDDEN_NAMES.has(tt)) return false;
  if (/[0-9_$#@!%^*()]/.test(fn)) return false;
  if (fn.split(/\s+/).length > 4) return false;

  return true;
}

function scoreEmail(
  email: string,
  firstName: string,
  lastName: string,
  domain: string,
): number {
  const normalizedEmail = email.toLowerCase();
  const [prefix, emailDomain] = normalizedEmail.split("@");

  const f = firstName.toLowerCase().replace(/[^a-z]/g, "");
  const l = lastName.toLowerCase().replace(/[^a-z]/g, "");
  const fi = f[0] || "";

  let score = 0;

  if (domain && emailDomain === domain) score += 50;
  else if (
    emailDomain &&
    !DISPOSABLE_DOMAINS.has(emailDomain) &&
    !PLACEHOLDER_DOMAINS.has(emailDomain)
  ) {
    score += 10;
  }

  if (f && prefix.includes(f)) score += 20;
  if (l && prefix.includes(l)) score += 20;

  if (
    f &&
    l &&
    (prefix === `${f}.${l}` ||
      prefix === `${f}${l}` ||
      prefix === `${fi}${l}` ||
      prefix === `${f}.${l[0]}`)
  ) {
    score += 20;
  }

  if (prefix === f) score += 10;

  return score;
}

function buildSerpQueries(
  firstName: string,
  lastName: string,
  companyName: string,
  domain: string,
): string[] {
  const queries: string[] = [];
  const fullName = `${firstName} ${lastName}`.trim();

  if (fullName && companyName) {
    queries.push(`"${fullName}" "${companyName}" email`);
  }

  if (fullName && domain) {
    queries.push(`"${fullName}" "${domain}" email`);
  }

  if (fullName && !domain && !companyName) {
    queries.push(`"${fullName}" email`);
  }

  if (!fullName && companyName) {
    queries.push(`"${companyName}" team email contact`);
  }

  if (!fullName && domain) {
    queries.push(`"${domain}" team email contact site:${domain}`);
  }

  return [...new Set(queries)].slice(0, 3);
}

function extractLinkedInSlug(linkedinUrl: string): string | null {
  try {
    const match = linkedinUrl.match(
      /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9-]+)/i,
    );

    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function generatePatternCandidates(
  firstName: string,
  lastName: string,
  domain: string,
): string[] {
  const f = firstName.toLowerCase().replace(/[^a-z]/g, "");
  const l = lastName.toLowerCase().replace(/[^a-z]/g, "");
  const fi = f[0] || "";
  const li = l[0] || "";

  if (!f || !domain) return [];

  const patterns = l
    ? [
      `${f}.${l}@${domain}`,
      `${fi}${l}@${domain}`,
      `${f}${l}@${domain}`,
      `${f}@${domain}`,
      `${f}.${li}@${domain}`,
      `${fi}.${l}@${domain}`,
    ]
    : [`${f}@${domain}`];

  return [...new Set(patterns)].filter(isValidEmailCandidate);
}

async function verifyMxRecord(domain: string): Promise<boolean> {
  if (
    !domain ||
    PLACEHOLDER_DOMAINS.has(domain.toLowerCase()) ||
    DISPOSABLE_DOMAINS.has(domain.toLowerCase())
  ) {
    return false;
  }

  try {
    const records = await dns.promises.resolveMx(domain);
    return Array.isArray(records) && records.length > 0;
  } catch {
    return false;
  }
}

async function parseSearchPromptWithGemini(prompt: string): Promise<{
  titles: string[];
  location?: string;
  industry?: string;
  keywords?: string;
}> {
  if (!prompt || prompt.trim().length < 3) {
    return { titles: ["Founder", "CEO", "VP Sales"] };
  }

  try {
    const { text } = await callGemini({
      agentName: "prospecting.search-prompt-parser",
      model: MODELS.RESEARCH,
      systemPrompt: [
        "You are an AI Prospecting Prompt Parser.",
        "Extract B2B target personas, job titles, location, industry, and keywords from natural language prompts.",
        'Return ONLY JSON: {"titles":["VP of Sales"],"location":"San Francisco","industry":"SaaS","keywords":"Series A"}',
        "Do not invent values that are not supported by the prompt.",
      ].join(" "),
      userPrompt: `Parse prompt: "${prompt}"`,
      metadata: { source: "gemini-prompt-parser" },
      temperature: 0.1,
      responseMimeType: "application/json",
    });

    const parsed = parseSafeJson<any>(text);

    return {
      titles:
        Array.isArray(parsed?.titles) && parsed.titles.length > 0
          ? parsed.titles
            .filter((title: unknown) => typeof title === "string")
            .map((title: string) => title.trim())
            .filter(Boolean)
          : [prompt],
      location:
        typeof parsed?.location === "string" && parsed.location.trim()
          ? parsed.location.trim()
          : undefined,
      industry:
        typeof parsed?.industry === "string" && parsed.industry.trim()
          ? parsed.industry.trim()
          : undefined,
      keywords:
        typeof parsed?.keywords === "string" && parsed.keywords.trim()
          ? parsed.keywords.trim()
          : prompt,
    };
  } catch {
    return { titles: [prompt], keywords: prompt };
  }
}



async function searchSerpEmail(
  domain: string,
  firstName: string,
  lastName: string,
  companyName: string,
): Promise<string | null> {
  const apiKey = (
    process.env.SERPER_API_KEY ||
    process.env.SERPER_API_KEYS?.split(",")[0]
  )?.trim();

  if (!apiKey) return null;

  const queries = buildSerpQueries(
    firstName,
    lastName,
    companyName,
    domain,
  );

  if (!queries.length) return null;

  const allCandidates: Array<{ email: string; score: number }> = [];

  await Promise.allSettled(
    queries.map(async (query) => {
      try {
        const response = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: {
            "X-API-KEY": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            q: query,
            num: 5,
          }),
          signal: AbortSignal.timeout(8000),
        });

        if (!response.ok) return;

        const data = (await response.json()) as {
          organic?: Array<{
            snippet?: string;
            title?: string;
            link?: string;
          }>;
          answerBox?: {
            snippet?: string;
          };
          knowledgeGraph?: {
            description?: string;
          };
        };

        const textBlob = [
          data.answerBox?.snippet || "",
          data.knowledgeGraph?.description || "",
          ...(data.organic || []).map(
            (item) =>
              `${item.title || ""} ${item.snippet || ""} ${item.link || ""
              }`,
          ),
        ].join(" ");

        const rawEmails = textBlob.match(EMAIL_PATTERN) || [];

        for (const rawEmail of rawEmails) {
          const email = normalizeEmail(rawEmail);

          if (!email) continue;

          const score = scoreEmail(
            email,
            firstName,
            lastName,
            domain,
          );

          if (score > 0) {
            allCandidates.push({
              email,
              score,
            });
          }
        }
      } catch { }
    }),
  );

  if (!allCandidates.length) return null;

  const scores = new Map<string, number>();

  for (const candidate of allCandidates) {
    scores.set(
      candidate.email,
      (scores.get(candidate.email) || 0) + candidate.score,
    );
  }

  const deduped = Array.from(scores.entries())
    .map(([email, score]) => ({ email, score }))
    .sort((a, b) => b.score - a.score);

  const exactDomainMatch = deduped.find(
    (candidate) =>
      Boolean(domain) &&
      candidate.email.endsWith(`@${domain}`),
  );

  if (exactDomainMatch) {
    return exactDomainMatch.email;
  }

  const bestMatch = deduped[0];

  if (bestMatch && bestMatch.score >= 20) {
    return bestMatch.email;
  }

  return null;
}

async function predictEmailWithGemini(
  firstName: string,
  lastName: string,
  companyName: string,
  domain: string,
): Promise<string | null> {
  if (!firstName || !domain) return null;

  const patterns = generatePatternCandidates(
    firstName,
    lastName,
    domain,
  );

  if (!patterns.length) return null;

  try {
    const { text } = await callGemini({
      agentName: "prospecting.email-prediction",
      model: MODELS.RESEARCH,
      systemPrompt: [
        "You predict professional email address patterns.",
        "You are not verifying mailbox existence.",
        "Only return an address using the supplied domain.",
        'Return ONLY JSON: {"email":"person@domain.com","confidence":0.85,"pattern":"first.last"}',
        "Never return role accounts.",
      ].join(" "),
      userPrompt: [
        `First Name: ${firstName}`,
        `Last Name: ${lastName}`,
        `Company: ${companyName}`,
        `Domain: ${domain}`,
        `Candidate patterns: ${patterns.slice(0, 4).join(", ")}`,
      ].join("\n"),
      metadata: { source: "gemini-email-predict" },
      temperature: 0.05,
      responseMimeType: "application/json",
    });

    const parsed = parseSafeJson<{
      email?: string;
      confidence?: number;
    }>(text);

    const candidate = normalizeEmail(parsed?.email);

    if (
      candidate &&
      candidate.endsWith(`@${domain}`) &&
      typeof parsed?.confidence === "number" &&
      parsed.confidence >= 0.5
    ) {
      return candidate;
    }
  } catch { }

  if (patterns[0] && (await verifyMxRecord(domain))) {
    return patterns[0];
  }

  return null;
}

async function revealApolloEmail(
  apolloId: string,
): Promise<string | null> {
  const apiKey = (
    process.env.APOLLO_API_KEY ||
    process.env.APOLLO_API_KEYS?.split(",")[0]
  )?.trim();

  if (!apiKey || !apolloId) return null;

  try {
    const response = await fetch(
      "https://api.apollo.io/api/v1/people/bulk_match",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": apiKey,
        },
        body: JSON.stringify({
          details: [{ id: apolloId }],
          reveal_personal_emails: false,
          reveal_phone_number: false,
        }),
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!response.ok) return null;

    const data = (await response.json()) as {
      matches?: Array<{
        email?: string;
      }>;
    };

    return normalizeEmail(data.matches?.[0]?.email);
  } catch {
    return null;
  }
}

router.post("/search", async (req, res) => {
  try {
    const {
      q,
      titles = [],
      seniorities = [],
      locations = [],
      industries = [],
      employeeRanges = [],
      fundingStages = [],
      signals = [],
      technologies = [],
      page = 1,
      limit = 25,
    } = req.body;

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(
      100,
      Math.max(1, Number(limit) || 25),
    );

    let parsed = {
      titles: Array.isArray(titles) ? titles : [],
      location: Array.isArray(locations)
        ? locations[0]
        : undefined,
      industry: Array.isArray(industries)
        ? industries[0]
        : undefined,
    };

    if (
      typeof q === "string" &&
      q.trim().length > 0
    ) {
      const parsedPrompt =
        await parseSearchPromptWithGemini(q);

      if (
        parsed.titles.length === 0 &&
        parsedPrompt.titles.length > 0
      ) {
        parsed.titles = parsedPrompt.titles;
      }

      if (
        !parsed.location &&
        parsedPrompt.location
      ) {
        parsed.location = parsedPrompt.location;
      }

      if (
        !parsed.industry &&
        parsedPrompt.industry
      ) {
        parsed.industry = parsedPrompt.industry;
      }
    }

    const effectiveTitles =
      parsed.titles.length > 0
        ? parsed.titles
        : ["Founder", "CEO", "VP Sales"];

    const effectiveLocation =
      parsed.location ||
      (Array.isArray(locations) ? locations[0] : undefined);

    const effectiveIndustry =
      parsed.industry ||
      (Array.isArray(industries) ? industries[0] : undefined);

    const [apolloRaw, serpRaw] =
      await Promise.allSettled([
        apolloPeopleSearchMultiPage({
          titles: effectiveTitles,
          industry: effectiveIndustry,
          region: effectiveLocation,
          seniority: Array.isArray(seniorities)
            ? seniorities
            : [],
          employeeRanges: Array.isArray(employeeRanges)
            ? employeeRanges
            : [],
          fundingStages: Array.isArray(fundingStages)
            ? fundingStages
            : [],
          technologies: Array.isArray(technologies)
            ? technologies
            : [],
          maxPages: 3,
        }),
        searchSerpPeople({
          q,
          titles: effectiveTitles,
          locations: effectiveLocation
            ? [effectiveLocation]
            : [],
          industries: effectiveIndustry
            ? [effectiveIndustry]
            : [],
        }),
      ]);

    const apolloPeople =
      apolloRaw.status === "fulfilled" &&
        Array.isArray(apolloRaw.value)
        ? apolloRaw.value
        : [];

    const serpPeople =
      serpRaw.status === "fulfilled" &&
        Array.isArray(serpRaw.value)
        ? serpRaw.value
        : [];

    const filteredApollo = apolloPeople
      .map((person: any, idx: number) => {
        const company =
          normalizeText(
            person.organization_name ||
            person.organization?.name,
          ) || "Company";

        const firstName =
          normalizeText(person.first_name) ||
          normalizeText(person.name?.split(" ")[0]) ||
          "Prospect";

        const lastName =
          normalizeText(person.last_name) ||
          normalizeText(
            person.name
              ?.split(" ")
              .slice(1)
              .join(" "),
          );

        const title =
          normalizeText(person.title) ||
          "Decision Maker";

        const email =
          normalizeEmail(person.email);

        const detectedSignals: Array<{
          signalType: string;
          confidence: number;
          explanation: string;
        }> = [];

        if (
          (Array.isArray(fundingStages) &&
            fundingStages.length > 0) ||
          person.organization?.latest_funding_stage
        ) {
          detectedSignals.push({
            signalType: "FUNDING_SIGNAL",
            confidence: 0.92,
            explanation: `Funding stage: ${person.organization
              ?.latest_funding_stage ||
              fundingStages[0] ||
              "Active"
              }`,
          });
        }

        if (
          (Array.isArray(signals) &&
            signals.includes("HIRING")) ||
          person.organization?.hiring_job_count > 0
        ) {
          detectedSignals.push({
            signalType: "HIRING_SIGNAL",
            confidence: 0.88,
            explanation: "Active hiring surge",
          });
        }

        if (
          Array.isArray(signals) &&
          signals.includes("GROWTH")
        ) {
          detectedSignals.push({
            signalType: "GROWTH_SIGNAL",
            confidence: 0.85,
            explanation: "Headcount growth > 15%",
          });
        }

        if (
          Array.isArray(technologies) &&
          technologies.length > 0
        ) {
          detectedSignals.push({
            signalType: "TECH_SIGNAL",
            confidence: 0.9,
            explanation: `Tech stack match: ${technologies.join(", ")}`,
          });
        }

        if (!detectedSignals.length) {
          detectedSignals.push({
            signalType: "INTENT_SIGNAL",
            confidence: email ? 0.92 : 0.8,
            explanation: `${title} at ${company}`,
          });
        }

        return {
          id: `lead-${person.id || idx}`,
          externalId: person.id,
          firstName,
          lastName,
          companyName: company,
          website:
            normalizeDomain(
              person.organization?.website_url ||
              person.website_url,
            ) || null,
          title,
          email,
          emailStatus: email
            ? "VERIFIED"
            : "UNVERIFIED",
          seniority:
            normalizeText(person.seniority) ||
            seniorities[0] ||
            "Executive",
          location: person.city
            ? `${person.city}${person.state
              ? `, ${person.state}`
              : person.country
                ? `, ${person.country}`
                : ""
            }`
            : effectiveLocation ||
            "United States",
          linkedinUrl:
            normalizeText(person.linkedin_url) ||
            normalizeText(
              person.organization?.linkedin_url,
            ) ||
            null,
          qualificationScore: email
            ? 0.92
            : 0.8,
          source: "SCOUT_ENGINE",
          signals: detectedSignals,
        };
      })
      .filter((person) =>
        isStrongPersonRecord(
          person.firstName,
          person.lastName,
          person.companyName,
          person.title,
        ),
      );

    const filteredSerp = serpPeople.filter((person: any) =>
      isStrongPersonRecord(
        person.firstName,
        person.lastName,
        person.companyName,
        person.title,
      ),
    );

    const authReq =
      req as AuthenticatedRequest;

    const where: any = {
      deletedAt: null,
      campaign: {
        createdById: authReq.user!.userId,
      },
    };

    if (
      typeof q === "string" &&
      q.trim()
    ) {
      where.OR = [
        {
          companyName: {
            contains: q.trim(),
            mode: "insensitive",
          },
        },
        {
          firstName: {
            contains: q.trim(),
            mode: "insensitive",
          },
        },
        {
          lastName: {
            contains: q.trim(),
            mode: "insensitive",
          },
        },
        {
          title: {
            contains: q.trim(),
            mode: "insensitive",
          },
        },
        {
          email: {
            contains: q.trim(),
            mode: "insensitive",
          },
        },
      ];
    }

    const dbLeads = await prisma.lead.findMany({
      where,
      take: safeLimit,
      skip: (safePage - 1) * safeLimit,
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        companyName: true,
        website: true,
        title: true,
        email: true,
        emailStatus: true,
        seniority: true,
        qualificationScore: true,
        source: true,
        linkedinUrl: true,
        signals: {
          select: {
            signalType: true,
            confidence: true,
            explanation: true,
          },
          take: 3,
        },
      },
    });

    const formattedDbLeads = dbLeads
      .filter((lead: any) =>
        isStrongPersonRecord(
          lead.firstName || "",
          lead.lastName || "",
          lead.companyName || "",
          lead.title || "",
        ),
      )
      .map((lead: any) => ({
        id: lead.id,
        externalId: lead.id,
        firstName: lead.firstName || "",
        lastName: lead.lastName || "",
        companyName: lead.companyName,
        website: lead.website,
        title: lead.title || "Professional",
        email: normalizeEmail(lead.email),
        emailStatus:
          lead.emailStatus ||
          (lead.email ? "VERIFIED" : "UNVERIFIED"),
        seniority:
          lead.seniority || "Mid-Senior",
        location: "United States",
        linkedinUrl:
          lead.linkedinUrl || null,
        qualificationScore:
          lead.qualificationScore || 0.75,
        source: lead.source || "DATABASE",
        signals:
          lead.signals.length > 0
            ? lead.signals
            : [
              {
                signalType: "INTENT_SIGNAL",
                confidence: 0.75,
                explanation:
                  "Target ICP match",
              },
            ],
      }));

    const combined = [
      ...filteredApollo,
      ...filteredSerp,
      ...formattedDbLeads,
    ];

    const uniqueMap = new Map<string, any>();

    for (const item of combined) {
      const emailKey = item.email
        ? `email:${item.email.toLowerCase()}`
        : null;

      const linkedinKey =
        typeof item.linkedinUrl === "string" &&
          item.linkedinUrl
          ? `linkedin:${item.linkedinUrl
            .toLowerCase()
            .replace(/\/+$/, "")}`
          : null;

      const personKey = `person:${[
        item.firstName,
        item.lastName,
        item.companyName,
      ]
        .map((value: string) =>
          value
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim(),
        )
        .join("|")}`;

      const keys = [
        emailKey,
        linkedinKey,
        personKey,
      ].filter(Boolean) as string[];

      const existingKey =
        keys.find((key) => uniqueMap.has(key)) ||
        keys[0];

      if (!existingKey) continue;

      if (!uniqueMap.has(existingKey)) {
        uniqueMap.set(existingKey, item);
      }
    }

    const finalResults = Array.from(
      new Map(
        Array.from(uniqueMap.values()).map(
          (item: any) => [
            [
              item.firstName,
              item.lastName,
              item.companyName,
            ]
              .map((value: string) =>
                value
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, " ")
                  .trim(),
              )
              .join("|"),
            item,
          ],
        ),
      ).values(),
    );

    res.json({
      success: true,
      data: finalResults,
      meta: {
        page: safePage,
        limit: safeLimit,
        total: finalResults.length,
        sources: {
          scoutEngine: filteredApollo.length,
          serpXray: filteredSerp.length,
          database: formattedDbLeads.length,
        },
      },
    });
  } catch (err: any) {
    logger.error({ err }, "[prospecting] /search failed");
    res.status(500).json({
      success: false,
      error: "An error occurred while searching prospects. Please try again.",
    });
  }
});

router.post("/reveal-email", async (req, res) => {
  try {
    const {
      externalId,
      firstName = "",
      lastName = "",
      companyName = "",
      website = "",
      currentEmail = null,
      linkedinUrl = null,
    } = req.body;

    const normalizedFirstName =
      normalizeText(firstName);
    const normalizedLastName =
      normalizeText(lastName);
    const normalizedCompany =
      normalizeText(companyName);

    let domain = normalizeDomain(website);

    if (!domain && currentEmail) {
      const normalizedCurrent =
        normalizeEmail(currentEmail);

      if (normalizedCurrent) {
        domain =
          normalizedCurrent.split("@")[1] || "";
      }
    }

    if (
      domain &&
      (PLACEHOLDER_DOMAINS.has(domain) ||
        DISPOSABLE_DOMAINS.has(domain))
    ) {
      domain = "";
    }

    if (
      normalizedFirstName &&
      normalizedCompany
    ) {
      const localSibling =
        await prisma.lead.findFirst({
          where: {
            companyName: {
              contains: normalizedCompany,
              mode: "insensitive",
            },
            firstName: {
              contains: normalizedFirstName,
              mode: "insensitive",
            },
            email: {
              not: null,
            },
            deletedAt: null,
          },
          select: {
            email: true,
            emailStatus: true,
          },
        });

      const cachedEmail = normalizeEmail(
        localSibling?.email,
      );

      if (cachedEmail) {
        const cachedDomain =
          cachedEmail.split("@")[1] || "";
        const mxValid =
          await verifyMxRecord(cachedDomain);

        res.json({
          success: true,
          email: cachedEmail,
          emailStatus:
            localSibling?.emailStatus ||
            (mxValid ? "VERIFIED" : "UNVERIFIED"),
          source: "LOCAL_CACHE",
          mxValid,
          isRoleAccount: false,
        });
        return;
      }
    }

    let resolvedEmail: string | null = null;
    let source = "EXHAUSTED";

    if (
      externalId &&
      typeof externalId === "string" &&
      !externalId.startsWith("lead-") &&
      !externalId.startsWith("serp-")
    ) {
      resolvedEmail =
        await revealApolloEmail(externalId);

      if (resolvedEmail) {
        source = "APOLLO_PAID_REVEAL";
      }
    }

    if (!resolvedEmail) {
      resolvedEmail = await searchSerpEmail(
        domain,
        normalizedFirstName,
        normalizedLastName,
        normalizedCompany,
      );

      if (resolvedEmail) {
        source = "SERP_SEARCH_VERIFIED";
      }
    }

    if (
      !resolvedEmail &&
      normalizedFirstName &&
      domain
    ) {
      resolvedEmail =
        await predictEmailWithGemini(
          normalizedFirstName,
          normalizedLastName,
          normalizedCompany,
          domain,
        );

      if (resolvedEmail) {
        source = "GEMINI_PATTERN_PREDICTED";
      }
    }

    if (!resolvedEmail) {
      res.json({
        success: true,
        email: null,
        emailStatus: "NOT_FOUND",
        source: "EXHAUSTED",
        mxValid: false,
        isRoleAccount: false,
      });
      return;
    }

    const emailPrefix =
      resolvedEmail
        .split("@")[0]
        ?.toLowerCase() || "";

    const emailDomain =
      resolvedEmail
        .split("@")[1]
        ?.toLowerCase() || "";

    const isRoleAccount =
      ROLE_ACCOUNT_PREFIXES.has(emailPrefix);

    const hasMx =
      await verifyMxRecord(emailDomain);

    const isDirectlySourced =
      source === "LOCAL_CACHE" ||
      source === "SERP_SEARCH_VERIFIED" ||
      source === "APOLLO_PAID_REVEAL";

    const emailStatus =
      !isRoleAccount &&
        hasMx &&
        isDirectlySourced
        ? "VERIFIED"
        : "UNVERIFIED";

    res.json({
      success: true,
      email: resolvedEmail,
      emailStatus,
      source: isRoleAccount
        ? "ROLE_ACCOUNT_UNVERIFIED"
        : source,
      mxValid: hasMx,
      isRoleAccount,
    });
  } catch (err: any) {
    logger.error({ err }, "[prospecting] /reveal-email failed");
    res.status(500).json({
      success: false,
      error: "An error occurred while revealing the email. Please try again.",
    });
  }
});

router.post("/save-to-leads", async (req, res) => {
  try {
    const authReq =
      req as AuthenticatedRequest;

    const userId = authReq.user!.userId;
    const orgId = authReq.user!.orgId;

    const {
      prospects = [],
      campaignId: requestedCampaignId,
    } = req.body;

    if (
      !Array.isArray(prospects) ||
      prospects.length === 0
    ) {
      res.status(400).json({
        success: false,
        error: "No prospects provided",
      });
      return;
    }

    const uniqueProspects = new Map<
      string,
      any
    >();

    for (const prospect of prospects) {
      if (!prospect) continue;

      const firstName =
        normalizeText(prospect.firstName);
      const lastName =
        normalizeText(prospect.lastName);
      const companyName =
        normalizeText(prospect.companyName);
      const email =
        normalizeEmail(prospect.email);

      if (
        !isStrongPersonRecord(
          firstName,
          lastName,
          companyName,
          normalizeText(prospect.title) ||
          "Decision Maker",
        )
      ) {
        continue;
      }

      const key = email
        ? `email:${email}`
        : `person:${[
          firstName,
          lastName,
          companyName,
        ]
          .map((value) =>
            value
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, " ")
              .trim(),
          )
          .join("|")}`;

      if (!uniqueProspects.has(key)) {
        uniqueProspects.set(key, {
          ...prospect,
          firstName,
          lastName,
          companyName,
          email,
        });
      }
    }

    if (!uniqueProspects.size) {
      res.status(400).json({
        success: false,
        error: "No valid prospects provided",
      });
      return;
    }

    let targetCampaignId =
      requestedCampaignId;

    if (targetCampaignId) {
      const owned =
        await prisma.campaign.findFirst({
          where: {
            id: targetCampaignId,
            createdById: userId,
            deletedAt: null,
          },
          select: {
            id: true,
          },
        });

      if (!owned) {
        res.status(403).json({
          success: false,
          error:
            "Campaign not found or unauthorized",
        });
        return;
      }
    } else {
      let defaultCampaign =
        await prisma.campaign.findFirst({
          where: {
            name: "Discovered Leads",
            createdById: userId,
            deletedAt: null,
          },
          select: {
            id: true,
          },
        });

      if (!defaultCampaign) {
        if (!orgId) {
          res.status(500).json({
            success: false,
            error:
              "User has no organization",
          });
          return;
        }

        defaultCampaign =
          await prisma.campaign.create({
            data: {
              name: "Discovered Leads",
              description:
                "Default repository for discovered prospects",
              status: "DRAFT",
              createdById: userId,
              orgId,
              icpDescription:
                "General B2B Decision Makers",
            },
            select: {
              id: true,
            },
          });
      }

      targetCampaignId =
        defaultCampaign.id;
    }

    const existingLeads =
      await prisma.lead.findMany({
        where: {
          campaignId: targetCampaignId,
          deletedAt: null,
          OR: Array.from(
            uniqueProspects.values(),
          ).flatMap((prospect) => {
            const conditions: any[] = [];

            if (prospect.email) {
              conditions.push({
                email: prospect.email,
              });
            }

            conditions.push({
              firstName: prospect.firstName,
              lastName: prospect.lastName,
              companyName:
                prospect.companyName,
            });

            return conditions;
          }),
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          companyName: true,
        },
      });

    const existingKeys = new Set<string>();

    for (const lead of existingLeads) {
      const email = normalizeEmail(lead.email);

      if (email) {
        existingKeys.add(
          `email:${email}`,
        );
      }

      existingKeys.add(
        `person:${[
          lead.firstName || "",
          lead.lastName || "",
          lead.companyName || "",
        ]
          .map((value) =>
            value
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, " ")
              .trim(),
          )
          .join("|")}`,
      );
    }

    let inserted = 0;

    for (const prospect of uniqueProspects.values()) {
      const email = prospect.email;

      const key = email
        ? `email:${email}`
        : `person:${[
          prospect.firstName,
          prospect.lastName,
          prospect.companyName,
        ]
          .map((value: string) =>
            value
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, " ")
              .trim(),
          )
          .join("|")}`;

      if (existingKeys.has(key)) {
        continue;
      }

      try {
        await prisma.lead.create({
          data: {
            campaignId: targetCampaignId!,
            firstName:
              prospect.firstName || null,
            lastName:
              prospect.lastName || null,
            email: email || null,
            emailStatus: email
              ? prospect.emailStatus ===
                "VERIFIED"
                ? EmailStatus.FOUND
                : EmailStatus.FOUND
              : EmailStatus.NOT_ATTEMPTED,
            emailVerified:
              prospect.emailStatus ===
              "VERIFIED",
            title:
              normalizeText(prospect.title) ||
              null,
            companyName:
              prospect.companyName,
            website:
              normalizeDomain(
                prospect.website,
              ) || null,
            linkedinUrl:
              typeof prospect.linkedinUrl ===
                "string" &&
                prospect.linkedinUrl.trim()
                ? prospect.linkedinUrl.trim()
                : null,
            qualificationScore:
              typeof prospect.qualificationScore ===
                "number"
                ? Math.min(
                  1,
                  Math.max(
                    0,
                    prospect.qualificationScore,
                  ),
                )
                : 0.75,
            qualificationReason:
              "Discovered via B2B Lead Search",
            source: "DISCOVERY_ENGINE",
            pipelineStage: "PROSPECT",
            seniority:
              normalizeText(
                prospect.seniority,
              ) || null,
            signals: {
              create: [
                {
                  signalType:
                    "INTENT_SIGNAL",
                  value: `${normalizeText(
                    prospect.title,
                  ) ||
                    "Decision Maker"
                    } at ${prospect.companyName
                    }`,
                  confidence: 0.85,
                  explanation:
                    "Matched search criteria",
                },
              ],
            },
          },
          select: { id: true },
        });

        existingKeys.add(key);
        inserted++;
      } catch { }
    }

    res.json({
      success: true,
      message: `Successfully saved ${inserted} leads to database`,
      inserted,
      campaignId: targetCampaignId,
    });
  } catch (err: any) {
    logger.error({ err }, "[prospecting] /save-to-leads failed");
    res.status(500).json({
      success: false,
      error: "An error occurred while saving prospects. Please try again.",
    });
  }
});

export default router;