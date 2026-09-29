import dns from "dns";

export const PLACEHOLDER_DOMAINS = new Set([
    "domain.com",
    "company.com",
    "example.com",
    "test.com",
    "unverified.local",
    "email.com",
    "mail.com",
    "placeholder.com",
]);

export const DISPOSABLE_DOMAINS = new Set([
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

export const ROLE_ACCOUNT_PREFIXES = new Set([
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

export const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]{2,}@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

export const FORBIDDEN_NAMES = new Set([
    "prospect", "unknown", "person", "contact", "user", "lead", "profile", "member",
    "company", "business", "corporation", "inc", "ltd", "llc", "decision maker",
]);

export function resolveSerperApiKey(): string | undefined {
    return (process.env.SERPER_API_KEY || process.env.SERPER_API_KEYS?.split(",")[0])?.trim() || undefined;
}

export function resolveApolloApiKey(): string | undefined {
    return (process.env.APOLLO_API_KEY || process.env.APOLLO_API_KEYS?.split(",")[0])?.trim() || undefined;
}

export function isRealPerson(firstName: string, lastName: string, companyName: string, title: string): boolean {
    const fn = firstName.trim().toLowerCase();
    const ln = lastName.trim().toLowerCase();
    const cn = companyName.trim().toLowerCase();
    const tt = title.trim().toLowerCase();

    if (!fn || fn.length < 2 || FORBIDDEN_NAMES.has(fn)) return false;
    if (!cn || cn.length < 2 || FORBIDDEN_NAMES.has(cn)) return false;
    if (!tt || tt.length < 2 || FORBIDDEN_NAMES.has(tt)) return false;
    if (/[0-9_$#@!%^*()]/.test(fn)) return false;
    return true;
}

export function isValidEmailCandidate(email: string): boolean {
    if (!email || !email.includes("@")) return false;
    const [prefix, domain] = email.split("@");
    if (!prefix || !domain) return false;
    if (prefix.length < 2 || prefix.length > 64) return false;
    if (domain.length < 4 || domain.length > 255) return false;
    if (ROLE_ACCOUNT_PREFIXES.has(prefix.toLowerCase())) return false;
    if (DISPOSABLE_DOMAINS.has(domain.toLowerCase())) return false;
    if (PLACEHOLDER_DOMAINS.has(domain.toLowerCase())) return false;
    if (/[^a-z0-9._+-]/i.test(prefix)) return false;
    return true;
}

export function scoreEmail(email: string, firstName: string, lastName: string, domain: string): number {
    let score = 0;
    const e = email.toLowerCase();
    const [prefix, emailDomain] = e.split("@");
    const f = firstName.toLowerCase().replace(/[^a-z]/g, "");
    const l = lastName.toLowerCase().replace(/[^a-z]/g, "");
    const fi = f[0] || "";

    if (domain && emailDomain === domain) {
        score += 50;
    } else if (emailDomain && !DISPOSABLE_DOMAINS.has(emailDomain) && !PLACEHOLDER_DOMAINS.has(emailDomain)) {
        score += 10;
    }

    if (f && prefix.includes(f)) score += 20;
    if (l && prefix.includes(l)) score += 20;
    if (f && l && (prefix.includes(`${f}.${l}`) || prefix.includes(`${f}${l}`))) score += 15;
    if (
        prefix === `${f}.${l}` ||
        prefix === `${fi}${l}` ||
        prefix === f ||
        prefix === `${f}.${l[0]}`
    ) score += 10;

    return score;
}

export function buildSerpQueries(firstName: string, lastName: string, companyName: string, domain: string): string[] {
    const queries: string[] = [];
    const fullName = `${firstName} ${lastName}`.trim();
    const company = companyName || "";
    const domainBase = domain ? domain.replace(/\.[a-z]{2,}$/, "") : "";

    if (fullName && company) {
        queries.push(`"${fullName}" "${company}" email`);
    }
    if (fullName && domain) {
        queries.push(`"${fullName}" ${domain} email`);
    }
    if (fullName && !domain && !company) {
        queries.push(`"${fullName}" email OR contact`);
    }
    if (!fullName && company) {
        queries.push(`"${company}" team email contact`);
    }
    if (!fullName && domain) {
        queries.push(`${domainBase} team email contact site:${domain}`);
    }

    return [...new Set(queries.filter(Boolean))].slice(0, 3);
}

export function extractLinkedInSlug(linkedinUrl: string): string | null {
    try {
        const match = linkedinUrl.match(/linkedin\.com\/in\/([a-zA-Z0-9-]+)/);
        return match?.[1] ?? null;
    } catch {
        return null;
    }
}

export function generatePatternCandidates(firstName: string, lastName: string, domain: string): string[] {
    const f = firstName.toLowerCase().replace(/[^a-z]/g, "");
    const l = lastName.toLowerCase().replace(/[^a-z]/g, "");
    const fi = f[0] || "";
    const li = l[0] || "";
    if (!f || !domain) return [];
    const patterns = [
        `${f}.${l}@${domain}`,
        `${f}${l}@${domain}`,
        `${fi}${l}@${domain}`,
        `${f}@${domain}`,
        `${f}.${li}@${domain}`,
        `${fi}.${l}@${domain}`,
    ];
    return l ? patterns : [`${f}@${domain}`];
}

export async function verifyMxRecord(domain: string): Promise<boolean> {
    if (!domain || PLACEHOLDER_DOMAINS.has(domain.toLowerCase())) return false;
    try {
        const records = await dns.promises.resolveMx(domain);
        return Boolean(records && records.length > 0);
    } catch {
        return false;
    }
}

export function resolveDomain(
    website: string | null | undefined,
    currentEmail: string | null | undefined,
    companyName: string | null | undefined,
): string {
    let domain = "";
    if (website) {
        try {
            domain = new URL(website.startsWith("http") ? website : `https://${website}`)
                .hostname.replace(/^www\./, "").toLowerCase();
        } catch { }
    }
    if (!domain && currentEmail && currentEmail.includes("@")) {
        domain = currentEmail.split("@")[1]?.toLowerCase() || "";
    }
    if (!domain && companyName) {
        const clean = companyName
            .toLowerCase()
            .replace(/\b(inc|ltd|llc|corp|co|group|technologies|technology|solutions|services|software|the)\b/g, "")
            .replace(/[^a-z0-9]/g, "")
            .trim();
        if (clean && clean.length > 2) domain = `${clean}.com`;
    }

    if (PLACEHOLDER_DOMAINS.has(domain) || DISPOSABLE_DOMAINS.has(domain)) {
        domain = "";
    }

    return domain;
}

export function inferAndApplyPatternFromSibling(
    siblingEmail: string,
    siblingFirstName: string | null,
    siblingLastName: string | null,
    targetFirstName: string,
    targetLastName: string,
    domain: string
): string | null {
    if (!siblingEmail || !siblingEmail.includes("@")) return null;
    const [siblingPrefix] = siblingEmail.toLowerCase().split("@");
    if (!siblingPrefix) return null;

    const sF = (siblingFirstName || "").toLowerCase().replace(/[^a-z]/g, "");
    const sL = (siblingLastName || "").toLowerCase().replace(/[^a-z]/g, "");
    const sFi = sF[0] || "";
    const sLi = sL[0] || "";

    const tF = targetFirstName.toLowerCase().replace(/[^a-z]/g, "");
    const tL = targetLastName.toLowerCase().replace(/[^a-z]/g, "");
    const tFi = tF[0] || "";
    const tLi = tL[0] || "";

    if (!tF || !domain) return null;

    let pattern: string | null = null;
    if (sF && sL) {
        if (siblingPrefix === `${sF}.${sL}`) pattern = `${tF}.${tL}`;
        else if (siblingPrefix === `${sF}${sL}`) pattern = `${tF}${tL}`;
        else if (siblingPrefix === `${sFi}${sL}`) pattern = `${tFi}${tL}`;
        else if (siblingPrefix === `${sF}.${sLi}`) pattern = `${tF}.${tLi}`;
        else if (siblingPrefix === `${sFi}.${sL}`) pattern = `${tFi}.${tL}`;
        else if (siblingPrefix === sF) pattern = tF;
    } else if (sF && siblingPrefix === sF) {
        pattern = tF;
    }

    if (pattern && isValidEmailCandidate(`${pattern}@${domain}`)) {
        return `${pattern}@${domain}`;
    }
    return null;
}