"use client";

import { useState, useMemo, useCallback } from "react";
import {
    Search, X, ChevronDown, ChevronUp, Check, Users, Zap,
    SlidersHorizontal, Sparkles, Building2, Cpu, Plus,
    ExternalLink, AlertCircle, RotateCcw, MapPin, ChevronLeft, ChevronRight,
} from "lucide-react";

const OPTS = {
    titles: ["CTO", "VP Engineering", "VP Product", "Head of Engineering", "Director of Engineering", "Head of Product"],
    industries: ["SaaS", "FinTech", "DevTools", "Healthcare IT", "EdTech", "MarTech", "eCommerce", "Cybersecurity"],
    sizes: ["1–10", "11–50", "51–200", "201–500", "501–1000", "1000+"],
    regions: ["United States", "United Kingdom", "Europe", "Asia Pacific", "Latin America", "Middle East"],
    tech: ["React", "Node.js", "Python", "AWS", "GCP", "Kubernetes", "PostgreSQL", "Stripe"],
    signals: ["Hiring", "Funding", "Product Launch", "Leadership Change", "Expansion", "Tech Adoption"],
};

const IND_RULES: [string[], string][] = [
    [["computer software", "saas", "software as a service", "software"], "SaaS"],
    [["financial", "fintech", "banking", "payment", "insurance"], "FinTech"],
    [["health", "medical", "hospital", "pharma", "biotech"], "Healthcare IT"],
    [["educat", "e-learning", "edtech", "learning"], "EdTech"],
    [["marketing", "advertising", "martech", "demand gen"], "MarTech"],
    [["retail", "ecommerce", "e-commerce", "consumer goods"], "eCommerce"],
    [["internet", "developer tools", "devtools", "tooling"], "DevTools"],
    [["security", "cyber", "infosec", "identity"], "Cybersecurity"],
];
const mapInd = (s: string): string | null => {
    const k = s.toLowerCase();
    for (const [keys, label] of IND_RULES) if (keys.some(key => k.includes(key))) return label;
    return null;
};

const SIZE_BANDS = [
    { label: "1–10", lo: 1, hi: 10 },
    { label: "11–50", lo: 11, hi: 50 },
    { label: "51–200", lo: 51, hi: 200 },
    { label: "201–500", lo: 201, hi: 500 },
    { label: "501–1000", lo: 501, hi: 1000 },
    { label: "1000+", lo: 1001, hi: Infinity },
];
const empToSize = (n?: number | null): string | null =>
    n ? (SIZE_BANDS.find(b => n >= b.lo && n <= b.hi)?.label ?? null) : null;
const mapSizeRange = (range: string): string[] => {
    const [lo, hi] = range.split(",").map(Number);
    if (isNaN(lo) || isNaN(hi)) return [];
    return SIZE_BANDS.filter(b => lo <= b.hi && hi >= b.lo).map(b => b.label);
};

const GEO_RULES: [string[], string][] = [
    [["united states", "usa", "north america"], "United States"],
    [["united kingdom", "britain"], "United Kingdom"],
    [["europe", "france", "germany", "netherlands", "sweden", "spain", "italy", "denmark"], "Europe"],
    [["asia", "australia", "japan", "singapore", "korea", "india", "china", "apac"], "Asia Pacific"],
    [["latin", "mexico", "brazil", "argentina", "colombia", "latam", "chile"], "Latin America"],
    [["middle east", "uae", "saudi", "dubai", "qatar", "israel", "mena"], "Middle East"],
];
const mapGeo = (s: string): string | null => {
    const k = s.toLowerCase();
    for (const [keys, label] of GEO_RULES) if (keys.some(key => k.includes(key))) return label;
    return null;
};

const SIGNAL_KEYWORD_MAP: Record<string, string[]> = {
    "Hiring": ["hiring", "jobs", "talent", "recrui"],
    "Funding": ["funded", "funding", "series", "investment", "raised", "venture"],
    "Product Launch": ["product launch", "new product", "release", "shipped"],
    "Leadership Change": ["new ceo", "new cto", "appointed", "leadership", "joined as"],
    "Expansion": ["expansion", "opened office", "new market", "scaling"],
    "Tech Adoption": ["integration", "migration", "implemented", "adopted", "deploy"],
};

const SIG_RULES: [string[], string][] = [
    [["hir"], "Hiring"],
    [["fund", "rais", "invest", "series", "round"], "Funding"],
    [["product launch", "new product", "release"], "Product Launch"],
    [["leader", "exec", "appointment", "new hire"], "Leadership Change"],
    [["expan", "growth", "scale", "open office"], "Expansion"],
    [["tech adopt", "integrat", "migrat", "implement"], "Tech Adoption"],
];
const mapSignal = (s: string): string | null => {
    const k = s.toLowerCase();
    for (const [keys, label] of SIG_RULES) if (keys.some(key => k.includes(key))) return label;
    return null;
};

const TITLE_KEYWORD_MAP: Record<string, string[]> = {
    "CTO": ["cto", "chief technology", "chief technical"],
    "VP Engineering": ["vp engineering", "vp of engineering", "vice president engineering", "vice president of engineering"],
    "VP Product": ["vp product", "vp of product", "vice president product", "vice president of product"],
    "Head of Engineering": ["head of engineering", "engineering lead", "engineering manager"],
    "Director of Engineering": ["director of engineering", "director, engineering"],
    "Head of Product": ["head of product", "product lead", "product manager"],
};

const mapTitle = (t: string): string | null => {
    const k = t.toLowerCase();
    return OPTS.titles.find(opt => {
        const o = opt.toLowerCase();
        return o === k || k.includes(o) || o.includes(k);
    }) ?? null;
};

const REGION_APOLLO_MAP: Record<string, string[]> = {
    "United States": ["United States"],
    "United Kingdom": ["United Kingdom"],
    "Europe": ["France", "Germany", "Netherlands", "Sweden", "Spain", "Italy", "Denmark", "Belgium", "Switzerland", "Austria", "Poland", "Portugal", "Norway", "Finland"],
    "Asia Pacific": ["Australia", "Japan", "Singapore", "South Korea", "India", "China", "New Zealand", "Hong Kong", "Malaysia", "Indonesia"],
    "Latin America": ["Mexico", "Brazil", "Argentina", "Colombia", "Chile", "Peru", "Ecuador"],
    "Middle East": ["United Arab Emirates", "Saudi Arabia", "Qatar", "Israel", "Kuwait", "Bahrain", "Oman", "Jordan", "Lebanon"],
};

interface CompanySize { label: string; range: string; }
interface ICPRefinement {
    summary?: string;
    titleKeywords: string[];
    industries: string[];
    companySizes: CompanySize[];
    geographies: string[];
    signals: string[];
    queryVariants?: string[];
}

interface FilterState {
    titles: string[];
    industries: string[];
    sizes: string[];
    regions: string[];
    tech: string[];
    signals: string[];
}

const refinementToFilters = (r: ICPRefinement): FilterState => ({
    titles: [...new Set(r.titleKeywords.map(mapTitle).filter(Boolean))] as string[],
    industries: [...new Set(r.industries.map(mapInd).filter(Boolean))] as string[],
    sizes: [...new Set(r.companySizes.flatMap(cs => mapSizeRange(cs.range)))],
    regions: [...new Set(r.geographies.map(mapGeo).filter(Boolean))] as string[],
    tech: [],
    signals: [...new Set(r.signals.map(mapSignal).filter(Boolean))] as string[],
});

const empDisplay = (n?: number | null): string => {
    if (!n) return "—";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
    return n.toLocaleString();
};

const avHue = (id: string): number => {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
    return ((h % 360) + 360) % 360;
};

const orgIni = (name: string): string =>
    name.split(/\s+/).slice(0, 2).map(w => w[0] ?? "").join("").toUpperCase();

const S = {
    bg: "var(--background)",
    bgMid: "var(--navy-mid)",
    bgCard: "var(--surface)",
    bgCardHover: "var(--surface-2)",
    border: "var(--border)",
    borderLight: "rgba(255,255,255,0.08)",
    accent: "var(--red)",
    accentDim: "var(--red-dim)",
    accentGlow: "var(--red-glow)",
    accentFaint: "rgba(233,69,96,0.06)",
    textPrimary: "var(--text-primary)",
    textSecondary: "var(--text-secondary)",
    textMuted: "var(--text-muted)",
    green: "#22c55e",
    greenBg: "rgba(34,197,94,0.08)",
    greenBorder: "rgba(34,197,94,0.25)",
    red: "var(--red)",
    redBg: "var(--red-glow)",
    redBorder: "var(--border-red)",
} as const;

interface SectionProps {
    title: string;
    icon: React.ReactNode;
    opts: string[];
    sel: string[];
    onToggle: (v: string) => void;
    searchable?: boolean;
    aiActive?: boolean;
}

function Section({ title, icon, opts, sel, onToggle, searchable, aiActive }: SectionProps) {
    const [open, setOpen] = useState(true);
    const [q, setQ] = useState("");
    const vis = searchable && q ? opts.filter(o => o.toLowerCase().includes(q.toLowerCase())) : opts;
    const hasActive = sel.length > 0;

    return (
        <div style={{ borderBottom: `1px solid ${S.border}` }}>
            <button
                onClick={() => setOpen(v => !v)}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 14px", background: "none", border: "none", cursor: "pointer" }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ color: hasActive ? "var(--red)" : S.textMuted, display: "flex", transition: "color 0.15s" }}>{icon}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: hasActive ? "var(--red)" : S.textSecondary, textTransform: "uppercase", letterSpacing: "0.07em", transition: "color 0.15s" }}>{title}</span>
                    {hasActive && (
                        <span style={{ background: S.accent, color: "white", fontSize: 9, fontWeight: 700, borderRadius: 99, minWidth: 15, height: 15, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>
                            {sel.length}
                        </span>
                    )}
                    {aiActive && hasActive && (
                        <span title="Set by AI" style={{ display: "flex", alignItems: "center" }}>
                            <Sparkles size={9} color="var(--red)" />
                        </span>
                    )}
                </div>
                {open ? <ChevronUp size={11} color={S.textMuted} /> : <ChevronDown size={11} color={S.textMuted} />}
            </button>
            {open && (
                <div style={{ padding: "0 10px 10px" }}>
                    {searchable && (
                        <div style={{ position: "relative", marginBottom: 6 }}>
                            <Search size={10} color={S.textMuted} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                            <input
                                value={q}
                                onChange={e => setQ(e.target.value)}
                                placeholder="Search…"
                                className="focus-visible:ring-1 focus-visible:ring-[var(--red)]/40 focus-visible:rounded"
                                style={{ width: "100%", background: S.bg, border: `1px solid ${S.borderLight}`, borderRadius: 5, padding: "4px 6px 4px 24px", fontSize: 11, color: S.textPrimary, outline: "none", boxSizing: "border-box" }}
                            />
                        </div>
                    )}
                    {vis.map(o => {
                        const on = sel.includes(o);
                        return (
                            <button
                                key={o}
                                onClick={() => onToggle(o)}
                                style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "5px 7px", borderRadius: 5, border: "none", background: on ? S.accentFaint : "transparent", cursor: "pointer", marginBottom: 1, transition: "background 0.1s" }}
                            >
                                <div style={{ width: 13, height: 13, borderRadius: 3, border: `1.5px solid ${on ? S.accent : S.borderLight}`, background: on ? S.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.1s" }}>
                                    {on && <Check size={8} color="white" />}
                                </div>
                                <span style={{ fontSize: 12, color: on ? "var(--text-primary)" : S.textSecondary, textAlign: "left" }}>{o}</span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

interface ApolloOrg {
    id: string;
    name: string;
    primary_domain?: string;
    website_url?: string;
    industry?: string;
    estimated_num_employees?: number;
    hq_location_country?: string;
    hq_location_city?: string;
    country?: string;
    city?: string;
    short_description?: string;
    keywords?: string[];
    intent_signals?: Array<{ name?: string } | string>;
    people?: Array<{
        first_name?: string;
        last_name?: string;
        title?: string;
        email?: string;
        linkedin_url?: string;
    }>;
}

export interface ICPSearchProps {
    campaignId: string;
    onAddOrgs?: (orgs: ApolloOrg[]) => void;
}

interface PersonRowProps {
    person: NonNullable<ApolloOrg["people"]>[number];
    orgId: string;
    orgName: string;
    org: ApolloOrg;
    campaignId: string;
    onAddOrgs?: (orgs: ApolloOrg[]) => void;
    added: Set<string>;
    setAdded: React.Dispatch<React.SetStateAction<Set<string>>>;
}

function PersonRow({ person, orgId, org, campaignId, onAddOrgs, added, setAdded }: PersonRowProps) {
    const key = `${orgId}::${person.email ?? person.linkedin_url ?? person.first_name}`;
    const isAdded = added.has(key);
    const [isAdding, setIsAdding] = useState(false);
    const fullName = [person.first_name, person.last_name].filter(Boolean).join(" ");

    const addPerson = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isAdded || isAdding) return;
        setIsAdding(true);

        const payload = {
            companyName: org.name,
            website: org.website_url ?? (org.primary_domain ? `https://${org.primary_domain}` : undefined),
            domain: org.primary_domain ?? undefined,
            campaignId,
            source: "apollo",
            externalId: `${org.id}::${person.email ?? person.linkedin_url ?? fullName}`,
            firstName: person.first_name ?? undefined,
            lastName: person.last_name ?? undefined,
            title: person.title ?? undefined,
            email: person.email ?? undefined,
            linkedinUrl: person.linkedin_url ?? undefined,
        };

        if (!campaignId) {
            onAddOrgs?.([{ ...org }]);
            setAdded(p => { const n = new Set(p); n.add(key); return n; });
            setIsAdding(false);
            return;
        }

        try {
            const res = await fetch("/api/leads", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error("Failed to add");
            setAdded(p => { const n = new Set(p); n.add(key); return n; });
        } catch (err) {
            console.error("[ICPSearch] addPerson failed:", err);
        } finally {
            setIsAdding(false);
        }
    };

    return (
        <div
            onClick={e => e.stopPropagation()}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 6, background: S.bgCard, border: `1px solid ${S.border}`, marginTop: 4 }}
        >
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: S.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fullName || "—"}</div>
                {person.title && <div style={{ fontSize: 11, color: S.textSecondary, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{person.title}</div>}
                {person.email && <div style={{ fontSize: 10, color: "#60A5FA", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{person.email}</div>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                {person.linkedin_url && (
                    <a
                        href={person.linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        style={{ display: "flex", alignItems: "center", color: "#60A5FA", opacity: 0.7 }}
                        title="View LinkedIn"
                    >
                        <ExternalLink size={12} />
                    </a>
                )}
                <button
                    onClick={addPerson}
                    disabled={isAdded || isAdding}
                    style={{ display: "flex", alignItems: "center", gap: 3, padding: "3px 9px", borderRadius: 5, border: `1px solid ${isAdded ? S.greenBorder : S.borderLight}`, background: isAdded ? S.greenBg : S.accentFaint, color: isAdded ? S.green : "var(--red)", fontSize: 10, fontWeight: 600, cursor: isAdded || isAdding ? "default" : "pointer", whiteSpace: "nowrap", transition: "all 0.15s" }}
                >
                    {isAdded ? <><Check size={9} /> Added</> : isAdding ? "Adding…" : <><Plus size={9} /> Add</>}
                </button>
            </div>
        </div>
    );
}

export function ICPSearch({ campaignId, onAddOrgs }: ICPSearchProps) {
    const [icp, setIcp] = useState("SaaS and FinTech companies, 50–500 employees. VP Engineering or CTO with active hiring signals and a funding round in the last 90 days.");
    const [icpOpen, setIcpOpen] = useState(true);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [f, setF] = useState<FilterState>({ titles: [], industries: [], sizes: [], regions: [], tech: [], signals: [] });
    const [sel, setSel] = useState<Set<string>>(new Set());
    const [added, setAdded] = useState<Set<string>>(new Set());
    const [sort, setSort] = useState("name");
    const [page, setPage] = useState(1);
    const [expandedContacts, setExpandedContacts] = useState<Set<string>>(new Set());
    const PER = 10;

    const [parsing, setParsing] = useState(false);
    const [searching, setSearching] = useState(false);
    const [orgs, setOrgs] = useState<ApolloOrg[]>([]);
    const [hasSearched, setHasSearched] = useState(false);
    const [parseError, setParseError] = useState<string | null>(null);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [refinement, setRefinement] = useState<ICPRefinement | null>(null);
    const [adding, setAdding] = useState<Set<string>>(new Set());
    const [aiFilters, setAiFilters] = useState<Partial<Record<keyof FilterState, boolean>>>({});

    const tamEstimate = useMemo(() => {
        let base = 250000;
        if (f.industries.length > 0) {
            let mult = 0;
            if (f.industries.includes("SaaS")) mult += 0.3;
            if (f.industries.includes("FinTech")) mult += 0.2;
            if (f.industries.includes("DevTools")) mult += 0.1;
            if (f.industries.includes("Healthcare IT")) mult += 0.15;
            if (f.industries.includes("Cybersecurity")) mult += 0.1;
            if (f.industries.includes("EdTech")) mult += 0.08;
            if (f.industries.includes("MarTech")) mult += 0.08;
            if (f.industries.includes("eCommerce")) mult += 0.12;
            base = base * Math.max(mult, 0.05);
        }
        if (f.sizes.length > 0) {
            let mult = 0;
            if (f.sizes.includes("1–10")) mult += 0.4;
            if (f.sizes.includes("11–50")) mult += 0.3;
            if (f.sizes.includes("51–200")) mult += 0.2;
            if (f.sizes.includes("201–500")) mult += 0.06;
            if (f.sizes.includes("501–1000")) mult += 0.03;
            if (f.sizes.includes("1000+")) mult += 0.01;
            base = base * Math.max(mult, 0.05);
        }
        if (f.regions.length > 0) {
            let mult = 0;
            if (f.regions.includes("United States")) mult += 0.5;
            if (f.regions.includes("United Kingdom")) mult += 0.15;
            if (f.regions.includes("Europe")) mult += 0.25;
            if (f.regions.includes("Asia Pacific")) mult += 0.1;
            if (f.regions.includes("Latin America")) mult += 0.05;
            if (f.regions.includes("Middle East")) mult += 0.03;
            base = base * Math.max(mult, 0.05);
        }
        if (f.titles.length > 0) {
            base = base * (0.2 + 0.1 * f.titles.length);
        }
        if (f.signals.length > 0) {
            base = base * (0.3 + 0.1 * f.signals.length);
        }
        return Math.max(Math.round(base), 12);
    }, [f]);

    const suggestedTags = useMemo(() => {
        const text = icp.toLowerCase();
        const suggestions: Array<{ key: keyof FilterState; value: string }> = [];
        if (text.includes("saas") && !f.industries.includes("SaaS")) suggestions.push({ key: "industries", value: "SaaS" });
        if (text.includes("fintech") && !f.industries.includes("FinTech")) suggestions.push({ key: "industries", value: "FinTech" });
        if (text.includes("devtools") && !f.industries.includes("DevTools")) suggestions.push({ key: "industries", value: "DevTools" });
        if ((text.includes("cto") || text.includes("technology")) && !f.titles.includes("CTO")) suggestions.push({ key: "titles", value: "CTO" });
        if ((text.includes("vp") || text.includes("vice president")) && !f.titles.includes("VP Engineering")) suggestions.push({ key: "titles", value: "VP Engineering" });
        if (text.includes("hiring") && !f.signals.includes("Hiring")) suggestions.push({ key: "signals", value: "Hiring" });
        if (text.includes("funding") && !f.signals.includes("Funding")) suggestions.push({ key: "signals", value: "Funding" });
        if ((text.includes("us") || text.includes("united states") || text.includes("america")) && !f.regions.includes("United States")) suggestions.push({ key: "regions", value: "United States" });
        if ((text.includes("uk") || text.includes("united kingdom")) && !f.regions.includes("United Kingdom")) suggestions.push({ key: "regions", value: "United Kingdom" });
        return suggestions.slice(0, 3);
    }, [icp, f]);

    const tog = (key: keyof FilterState) => (val: string) => {
        setF(p => ({ ...p, [key]: p[key].includes(val) ? p[key].filter(v => v !== val) : [...p[key], val] }));
        setPage(1);
    };
    const removeChip = (k: keyof FilterState, v: string) => { setF(p => ({ ...p, [k]: p[k].filter(x => x !== v) })); setPage(1); };
    const clearAll = () => { setF({ titles: [], industries: [], sizes: [], regions: [], tech: [], signals: [] }); setPage(1); };

    const toggleContactExpand = (orgId: string) => {
        setExpandedContacts(p => {
            const n = new Set(p);
            n.has(orgId) ? n.delete(orgId) : n.add(orgId);
            return n;
        });
    };

    const runSearch = useCallback(async (r: ICPRefinement) => {
        setSearching(true);
        setSearchError(null);
        setOrgs([]);
        setSel(new Set());
        try {
            const res = await fetch("/api/campaigns/apollo-preview", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ refinement: r }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error ?? "Apollo search failed");
            setOrgs(data.organizations ?? []);
            setHasSearched(true);
        } catch (err) {
            setSearchError(err instanceof Error ? err.message : "Apollo search failed");
        } finally {
            setSearching(false);
        }
    }, []);

    const parseAndApply = async () => {
        if (!icp.trim() || parsing || searching) return;
        setParsing(true);
        setParseError(null);
        setSearchError(null);
        setOrgs([]);
        setSel(new Set());
        setF({ titles: [], industries: [], sizes: [], regions: [], tech: [], signals: [] });
        setAiFilters({});
        setPage(1);
        try {
            const res = await fetch("/api/campaigns/icp-refine", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ icpDescription: icp.trim() }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error ?? "ICP parse failed");
            const r: ICPRefinement = data.refinement;
            setRefinement(r);
            const filters = refinementToFilters(r);
            setF(filters);
            const aiActive: Partial<Record<keyof FilterState, boolean>> = {};
            (Object.keys(filters) as (keyof FilterState)[]).forEach(k => {
                if (filters[k].length > 0) aiActive[k] = true;
            });
            setAiFilters(aiActive);
            setPage(1);
            await runSearch(r);
        } catch (err) {
            setParseError(err instanceof Error ? err.message : "Failed to parse ICP");
        } finally {
            setParsing(false);
        }
    };

    const addOrg = useCallback(async (org: ApolloOrg, e: React.MouseEvent | { stopPropagation: () => void }) => {
        e.stopPropagation();
        if (adding.has(org.id) || added.has(org.id)) return;

        setAdding(p => { const n = new Set(p); n.add(org.id); return n; });

        const person = org.people?.[0] ?? null;

        const payload = {
            companyName: org.name,
            website: org.website_url ?? (org.primary_domain ? `https://${org.primary_domain}` : undefined),
            domain: org.primary_domain ?? undefined,
            campaignId,
            source: "apollo",
            externalId: org.id,
            ...(person && {
                firstName: person.first_name ?? undefined,
                lastName: person.last_name ?? undefined,
                title: person.title ?? undefined,
                email: person.email ?? undefined,
                linkedinUrl: person.linkedin_url ?? undefined,
            }),
        };

        if (!campaignId) {
            onAddOrgs?.([{ ...org }]);
            setAdded(p => { const n = new Set(p); n.add(org.id); return n; });
            setAdding(p => { const n = new Set(p); n.delete(org.id); return n; });
            return;
        }

        try {
            const res = await fetch("/api/leads", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error("Failed to add");
            setAdded(p => { const n = new Set(p); n.add(org.id); return n; });
        } catch (err) {
            console.error("[ICPSearch] addOrg failed:", err);
        } finally {
            setAdding(p => { const n = new Set(p); n.delete(org.id); return n; });
        }
    }, [adding, added, campaignId, onAddOrgs]);

    const addSelected = async () => {
        const toAdd = [...sel].map(id => orgs.find(o => o.id === id)).filter(Boolean) as ApolloOrg[];
        for (const org of toAdd) {
            await addOrg(org, { stopPropagation: () => { } });
        }
        setSel(new Set());
    };

    const filtered = useMemo(() => {
        const out = orgs.filter(org => {
            if (f.industries.length) {
                const m = mapInd(org.industry ?? "");
                if (!m || !f.industries.includes(m)) return false;
            }
            if (f.sizes.length) {
                const s = empToSize(org.estimated_num_employees);
                if (!s || !f.sizes.includes(s)) return false;
            }
            if (f.tech.length) {
                const kws = (org.keywords ?? []).map(k => k.toLowerCase());
                if (!f.tech.some(t => kws.some(k => k.includes(t.toLowerCase())))) return false;
            }
            if (f.titles.length) {
                const people = org.people ?? [];
                const hasMatch = people.some(p => {
                    const titleLower = (p.title ?? "").toLowerCase();
                    return f.titles.some(filterTitle => {
                        const keywords = TITLE_KEYWORD_MAP[filterTitle] ?? [filterTitle.toLowerCase()];
                        return keywords.some(kw => titleLower.includes(kw));
                    });
                });
                if (!hasMatch) return false;
            }
            if (f.regions.length) {
                const country = (org.hq_location_country ?? org.country ?? "").toLowerCase();
                const city = (org.hq_location_city ?? org.city ?? "").toLowerCase();
                const locationStr = `${country} ${city}`;
                const hasMatch = f.regions.some(region => {
                    const targetCountries = REGION_APOLLO_MAP[region] ?? [];
                    return targetCountries.some(c => locationStr.includes(c.toLowerCase()));
                });
                if (!hasMatch) return false;
            }
            if (f.signals.length) {
                const kws = (org.keywords ?? []).map(k => k.toLowerCase());
                const intentSignals = (org.intent_signals ?? []).map(s => (typeof s === "string" ? s : (s.name ?? "")).toLowerCase());
                const allSignalText = [...kws, ...intentSignals].join(" ");
                const hasMatch = f.signals.some(signal => {
                    const matchTerms = SIGNAL_KEYWORD_MAP[signal] ?? [signal.toLowerCase()];
                    return matchTerms.some(term => allSignalText.includes(term));
                });
                if (!hasMatch) return false;
            }
            return true;
        });

        return [...out].sort(sort === "employees"
            ? (a, b) => (b.estimated_num_employees ?? 0) - (a.estimated_num_employees ?? 0)
            : (a, b) => a.name.localeCompare(b.name));
    }, [orgs, f, sort]);

    const rows = filtered.slice((page - 1) * PER, page * PER);
    const pages = Math.ceil(filtered.length / PER);
    const chips = (Object.entries(f) as [keyof FilterState, string[]][]).flatMap(([k, vs]) => vs.map(v => ({ k, v })));
    const allOnPage = rows.length > 0 && rows.every(o => sel.has(o.id));
    const isLoading = parsing || searching;

    const toggleOrg = (id: string) => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
    const togglePage = () => setSel(p => {
        const n = new Set(p);
        if (allOnPage) rows.forEach(o => n.delete(o.id));
        else rows.forEach(o => n.add(o.id));
        return n;
    });

    const addedCount = added.size;

    return (
        <div style={{ display: "flex", height: "100%", fontFamily: "Inter,-apple-system,sans-serif", background: S.bg, overflow: "hidden" }}>


            {/* ── SIDEBAR ── */}
            <div style={{ width: sidebarCollapsed ? 0 : 256, flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden", transition: "width 0.2s ease", borderRight: sidebarCollapsed ? "none" : `1px solid ${S.border}` }}>
                <div style={{ width: 256, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: S.bgMid }}>
                    <div style={{ padding: "13px 14px 11px", borderBottom: `1px solid ${S.border}`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: S.textPrimary, letterSpacing: "-0.02em" }}>ICP Builder</div>
                            <div style={{ fontSize: 10, color: S.textMuted, marginTop: 1 }}>Define targeting criteria</div>
                        </div>
                        <button
                            onClick={() => setSidebarCollapsed(true)}
                            className="icp-collapse-btn"
                            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: 6, background: "transparent", border: `1px solid ${S.border}`, cursor: "pointer", color: S.textMuted, transition: "background 0.15s" }}
                            title="Collapse sidebar"
                        >
                            <ChevronLeft size={12} />
                        </button>
                    </div>

                    <div style={{ overflowY: "auto", flex: 1 }}>
                        <div style={{ padding: "10px 12px", borderBottom: `1px solid ${S.border}` }}>
                            <button
                                onClick={() => setIcpOpen(v => !v)}
                                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", background: S.bgCard, border: `1px solid ${S.borderLight}`, borderRadius: 8, padding: "8px 10px", cursor: "pointer" }}
                            >
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <Sparkles size={12} color="#A78BFA" />
                                    <span style={{ fontSize: 11, color: "#A78BFA", fontWeight: 600 }}>ICP Description</span>
                                </div>
                                {icpOpen ? <ChevronUp size={11} color={S.textMuted} /> : <ChevronDown size={11} color={S.textMuted} />}
                            </button>
                            {icpOpen && (
                                <div style={{ marginTop: 8 }}>
                                    <textarea
                                        value={icp}
                                        onChange={e => { setIcp(e.target.value); if (parseError) setParseError(null); }}
                                        rows={4}
                                        className="focus-visible:ring-1 focus-visible:ring-[var(--red)]/40 focus-visible:rounded"
                                        style={{ width: "100%", background: S.bg, border: `1px solid ${S.borderLight}`, borderRadius: 6, padding: 8, fontSize: 11, color: S.textPrimary, resize: "none", outline: "none", lineHeight: 1.55, boxSizing: "border-box" }}
                                        placeholder="Describe your ideal customer profile…"
                                    />
                                    {parseError && (
                                        <div style={{ marginTop: 6, padding: "6px 8px", background: S.redBg, border: `1px solid ${S.redBorder}`, borderRadius: 5, fontSize: 11, color: "#F87171" }}>
                                            {parseError.length > 160 ? parseError.slice(0, 157) + "…" : parseError}
                                        </div>
                                    )}
                                    <button
                                        onClick={parseAndApply}
                                        disabled={isLoading}
                                        style={{ marginTop: 6, width: "100%", background: isLoading ? S.bgCard : `linear-gradient(135deg,${S.accent},${S.accentDim})`, color: isLoading ? S.textMuted : "white", border: "none", borderRadius: 6, padding: 7, fontSize: 11, fontWeight: 600, cursor: isLoading ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "opacity 0.15s" }}
                                    >
                                        {parsing ? "Parsing ICP…" : searching ? "Searching Apollo…" : "Parse & Search Apollo"}
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Audience Estimator Widget */}
                        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${S.border}` }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                                <span style={{ fontSize: 10, fontWeight: 700, color: S.textSecondary, textTransform: "uppercase", letterSpacing: "0.07em" }}>Audience Size</span>
                                <span style={{ fontSize: 11, fontWeight: 600, color: tamEstimate < 250 ? "var(--red)" : tamEstimate <= 15000 ? "#22c55e" : "#f59e0b" }}>
                                    {tamEstimate < 250 ? "Too Narrow" : tamEstimate <= 15000 ? "Ideal Size" : "Too Broad"}
                                </span>
                            </div>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 8 }}>
                                <span style={{ fontSize: 18, fontWeight: 800, color: S.textPrimary, fontFamily: "var(--font-display)" }}>{tamEstimate.toLocaleString()}</span>
                                <span style={{ fontSize: 10, color: S.textMuted }}>est. leads</span>
                            </div>
                            <div style={{ height: 4, width: "100%", background: S.border, borderRadius: 2, overflow: "hidden", marginBottom: 6 }}>
                                <div style={{ height: "100%", width: `${Math.min((tamEstimate / 30000) * 100, 100)}%`, background: tamEstimate < 250 ? "var(--red)" : tamEstimate <= 15000 ? "#22c55e" : "#f59e0b", borderRadius: 2, transition: "width 0.3s ease" }} />
                            </div>
                            <div style={{ fontSize: 10, color: S.textMuted, lineHeight: 1.45 }}>
                                {tamEstimate < 250 ? "Consider broadening your search filters to reach more prospects." : tamEstimate <= 15000 ? "Great targeting pool size for high deliverability and personalization." : "Target size is very broad. Add employee limits or specific technologies to narrow it."}
                            </div>
                        </div>

                        {/* Tag Suggester Widget */}
                        {suggestedTags.length > 0 && (
                            <div style={{ padding: "12px 14px", borderBottom: `1px solid ${S.border}` }}>
                                <div style={{ fontSize: 10, fontWeight: 700, color: S.textSecondary, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Suggested Filters</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                    {suggestedTags.map(({ key, value }) => (
                                        <button
                                            key={`${key}-${value}`}
                                            onClick={() => tog(key)(value)}
                                            style={{ fontSize: 10, background: S.bgCard, border: `1px solid ${S.borderLight}`, color: S.textSecondary, padding: "3px 6px", borderRadius: 4, cursor: "pointer", display: "flex", alignItems: "center", gap: 3, transition: "all 0.15s" }}
                                            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--red)"; e.currentTarget.style.borderColor = "var(--border-red)"; }}
                                            onMouseLeave={(e) => { e.currentTarget.style.color = S.textSecondary; e.currentTarget.style.borderColor = S.borderLight; }}
                                        >
                                            <Plus size={8} /> {value}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {hasSearched && refinement && (
                            <div style={{ padding: "10px 12px", borderBottom: `1px solid ${S.border}` }}>
                                <button
                                    onClick={() => runSearch(refinement)}
                                    disabled={searching}
                                    style={{ width: "100%", background: searching ? S.bgCard : S.bgCard, color: searching ? S.textMuted : "var(--red)", border: `1px solid ${S.borderLight}`, borderRadius: 6, padding: "7px 10px", fontSize: 11, fontWeight: 500, cursor: searching ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}
                                >
                                    <RotateCcw size={11} />
                                    Re-search Apollo
                                </button>
                                <div style={{ fontSize: 10, color: S.textMuted, marginTop: 5, textAlign: "center", lineHeight: 1.4 }}>
                                    Filters apply locally. Re-search sends a new Apollo query.
                                </div>
                            </div>
                        )}

                        <Section title="Job Title" icon={<Users size={12} />} opts={OPTS.titles} sel={f.titles} onToggle={tog("titles")} searchable aiActive={aiFilters.titles} />
                        <Section title="Industry" icon={<Building2 size={12} />} opts={OPTS.industries} sel={f.industries} onToggle={tog("industries")} aiActive={aiFilters.industries} />
                        <Section title="Company Size" icon={<Users size={12} />} opts={OPTS.sizes} sel={f.sizes} onToggle={tog("sizes")} aiActive={aiFilters.sizes} />
                        <Section title="Location" icon={<MapPin size={12} />} opts={OPTS.regions} sel={f.regions} onToggle={tog("regions")} aiActive={aiFilters.regions} />
                        <Section title="Technologies" icon={<Cpu size={12} />} opts={OPTS.tech} sel={f.tech} onToggle={tog("tech")} searchable aiActive={aiFilters.tech} />
                        <Section title="Buying Signals" icon={<Zap size={12} />} opts={OPTS.signals} sel={f.signals} onToggle={tog("signals")} aiActive={aiFilters.signals} />
                    </div>
                </div>
            </div>

            {/* Collapsed sidebar toggle */}
            {sidebarCollapsed && (
                <button
                    onClick={() => setSidebarCollapsed(false)}
                    className="icp-collapse-btn"
                    title="Expand sidebar"
                    style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", zIndex: 10, display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 44, background: S.bgCard, border: `1px solid ${S.border}`, borderLeft: "none", borderRadius: "0 6px 6px 0", cursor: "pointer", color: S.textMuted, transition: "background 0.15s" }}
                >
                    <ChevronRight size={12} />
                </button>
            )}

            {/* ── MAIN CONTENT ── */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0, position: "relative" }}>

                {/* Top bar */}
                <div style={{ background: S.bgMid, borderBottom: `1px solid ${S.border}`, padding: "9px 16px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <SlidersHorizontal size={13} color={S.textMuted} />
                        {isLoading ? (
                            <>
                                <span style={{ fontSize: 13, fontWeight: 700, color: S.textPrimary }}>…</span>
                                <span style={{ fontSize: 12, color: S.textSecondary }}>searching</span>
                            </>
                        ) : hasSearched ? (
                            <>
                                <span style={{ fontSize: 13, fontWeight: 700, color: S.textPrimary }}>{filtered.length.toLocaleString()}</span>
                                <span style={{ fontSize: 12, color: S.textSecondary }}>companies found</span>
                                {orgs.length > filtered.length && (
                                    <span style={{ fontSize: 11, color: S.textMuted }}>
                                        ({orgs.length - filtered.length} hidden by filters)
                                    </span>
                                )}
                            </>
                        ) : (
                            <span style={{ fontSize: 12, color: S.textMuted }}>Parse your ICP to search Apollo</span>
                        )}
                    </div>

                    <div style={{ flex: 1, display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                        {chips.map(({ k, v }) => (
                            <span
                                key={`${k}-${v}`}
                                style={{ display: "inline-flex", alignItems: "center", gap: 3, background: S.accentGlow, color: "var(--red)", fontSize: 11, fontWeight: 500, padding: "3px 7px", borderRadius: 99, border: `1px solid rgba(233,69,96,0.3)` }}
                            >
                                {v}
                                <button onClick={() => removeChip(k, v)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", color: "var(--red)" }}>
                                    <X size={10} />
                                </button>
                            </span>
                        ))}
                        {chips.length > 0 && (
                            <button onClick={clearAll} style={{ fontSize: 11, color: S.textMuted, background: "none", border: "none", cursor: "pointer", padding: "2px 4px", textDecoration: "underline" }}>
                                Clear all
                            </button>
                        )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        {addedCount > 0 && (
                            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: S.green, background: S.greenBg, border: `1px solid ${S.greenBorder}`, borderRadius: 99, padding: "3px 9px", fontWeight: 600 }}>
                                <Check size={10} /> {addedCount} added
                            </span>
                        )}
                        {sel.size > 0 && (
                            <button
                                onClick={addSelected}
                                style={{ background: `linear-gradient(135deg,${S.accent},${S.accentDim})`, color: "white", border: "none", borderRadius: 7, padding: "5px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
                            >
                                <Plus size={11} /> Add {sel.size} to campaign
                            </button>
                        )}
                        <select
                            value={sort}
                            onChange={e => setSort(e.target.value)}
                            className="focus-visible:ring-1 focus-visible:ring-[var(--red)]/40 focus-visible:rounded"
                            style={{ fontSize: 11, border: `1px solid ${S.borderLight}`, borderRadius: 6, padding: "5px 8px", color: S.textSecondary, background: S.bgCard, cursor: "pointer", outline: "none" }}
                        >
                            <option value="name">Name A–Z</option>
                            <option value="employees">Largest first</option>
                        </select>
                    </div>
                </div>

                {/* Select-all sub-bar */}
                <div style={{ background: S.bg, borderBottom: `1px solid ${S.border}`, padding: "5px 16px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    <button
                        onClick={togglePage}
                        style={{ display: "flex", alignItems: "center", gap: 7, background: "none", border: "none", cursor: "pointer", color: S.textSecondary, fontSize: 12 }}
                    >
                        <div style={{ width: 13, height: 13, border: `1.5px solid ${allOnPage ? S.accent : S.borderLight}`, borderRadius: 3, background: allOnPage ? S.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.1s" }}>
                            {allOnPage && <Check size={8} color="white" />}
                        </div>
                        Select page
                    </button>
                    {rows.length > 0 && (
                        <span style={{ fontSize: 11, color: S.textMuted }}>
                            {(page - 1) * PER + 1}–{Math.min(page * PER, filtered.length)} of {filtered.length}
                        </span>
                    )}
                </div>

                {/* Results */}
                <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                    {searching ? (
                        <div style={{ textAlign: "center", padding: "64px 20px" }}>
                            <div style={{ width: 40, height: 40, borderRadius: "50%", border: `3px solid ${S.border}`, borderTopColor: S.accent, margin: "0 auto 14px", animation: "icpspin 0.8s linear infinite" }} />
                            <div style={{ fontSize: 14, fontWeight: 600, color: S.textSecondary }}>Searching Apollo…</div>
                            <div style={{ fontSize: 12, color: S.textMuted, marginTop: 4 }}>Finding companies that match your ICP</div>
                        </div>
                    ) : searchError ? (
                        <div style={{ margin: "40px auto", maxWidth: 380, textAlign: "center", padding: 20 }}>
                            <AlertCircle size={32} color={"var(--red)"} style={{ margin: "0 auto 12px" }} />
                            <div style={{ fontSize: 14, fontWeight: 600, color: S.textPrimary }}>Apollo search failed</div>
                            <div style={{ fontSize: 12, color: S.textSecondary, marginTop: 6, marginBottom: 16 }}>{searchError}</div>
                            <button
                                onClick={() => refinement && runSearch(refinement)}
                                style={{ fontSize: 12, color: "var(--red)", background: S.accentFaint, border: `1px solid var(--border-red)`, borderRadius: 7, padding: "6px 16px", cursor: "pointer" }}
                            >
                                Try again
                            </button>
                        </div>
                    ) : !hasSearched ? (
                        <div style={{ textAlign: "center", padding: "64px 20px" }}>
                            <Sparkles size={36} color={S.border} style={{ margin: "0 auto 14px" }} />
                            <div style={{ fontSize: 14, fontWeight: 600, color: S.textSecondary }}>Describe your ICP to get started</div>
                            <div style={{ fontSize: 12, color: S.textMuted, marginTop: 4 }}>Paste a description above and click "Parse &amp; Search Apollo"</div>
                        </div>
                    ) : rows.length === 0 ? (
                        <div style={{ textAlign: "center", padding: "64px 20px" }}>
                            <Building2 size={36} color={S.border} style={{ margin: "0 auto 14px" }} />
                            <div style={{ fontSize: 14, fontWeight: 600, color: S.textSecondary }}>No companies match your filters</div>
                            <div style={{ fontSize: 12, color: S.textMuted, marginTop: 4 }}>Try broadening your criteria or re-searching</div>
                            {chips.length > 0 && (
                                <button
                                    onClick={clearAll}
                                    style={{ marginTop: 14, fontSize: 12, color: "var(--red)", background: S.accentFaint, border: `1px solid var(--border-red)`, borderRadius: 7, padding: "6px 16px", cursor: "pointer" }}
                                >
                                    Clear all filters
                                </button>
                            )}
                        </div>
                    ) : rows.map(org => {
                        const isSel = sel.has(org.id);
                        const isAdded = added.has(org.id);
                        const isAdding = adding.has(org.id);
                        const h = avHue(org.id);
                        const sizeLabel = empToSize(org.estimated_num_employees);
                        const keywords = (org.keywords ?? []).slice(0, 3);
                        const people = org.people ?? [];
                        const isExpanded = expandedContacts.has(org.id);
                        const location = [org.hq_location_city, org.hq_location_country ?? org.country].filter(Boolean).join(", ");

                        return (
                            <div
                                key={org.id}
                                className="icp-card"
                                onClick={() => toggleOrg(org.id)}
                                style={{ background: S.bgCard, border: `1px solid ${isSel ? "var(--border-red)" : S.border}`, borderRadius: 10, padding: "12px 14px", cursor: "pointer", boxShadow: isSel ? `0 0 0 3px ${S.accentGlow}` : "none", opacity: isAdded ? 0.5 : 1, transition: "all 0.12s" }}
                            >
                                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                    <div style={{ width: 14, height: 14, border: `1.5px solid ${isSel ? S.accent : S.borderLight}`, borderRadius: 3, background: isSel ? S.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.1s" }}>
                                        {isSel && <Check size={9} color="white" />}
                                    </div>

                                    <div style={{ width: 36, height: 36, borderRadius: 8, background: `hsl(${h},50%,18%)`, border: `1px solid hsl(${h},40%,28%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: `hsl(${h},70%,70%)`, flexShrink: 0 }}>
                                        {orgIni(org.name)}
                                    </div>

                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                            <span style={{ fontSize: 13, fontWeight: 600, color: S.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{org.name}</span>
                                            {org.primary_domain && (
                                                <a
                                                    href={`https://${org.primary_domain}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={e => e.stopPropagation()}
                                                    style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 11, color: S.textMuted, textDecoration: "none", flexShrink: 0 }}
                                                >
                                                    <ExternalLink size={10} />
                                                    {org.primary_domain}
                                                </a>
                                            )}
                                        </div>
                                        <div style={{ fontSize: 11, color: S.textSecondary, marginTop: 3, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                            {org.industry && <span>{org.industry}</span>}
                                            {sizeLabel && (
                                                <>
                                                    <span style={{ color: S.borderLight }}>·</span>
                                                    <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                                                        <Users size={10} /> {empDisplay(org.estimated_num_employees)}
                                                    </span>
                                                </>
                                            )}
                                            {location && (
                                                <>
                                                    <span style={{ color: S.borderLight }}>·</span>
                                                    <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                                                        <MapPin size={10} /> {location}
                                                    </span>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {keywords.length > 0 && (
                                        <div style={{ display: "none", flexWrap: "wrap", gap: 3, maxWidth: 140, justifyContent: "flex-end", flexShrink: 0, ...(typeof window !== "undefined" && window.innerWidth > 1024 ? { display: "flex" } : {}) }}>
                                            {keywords.map(k => (
                                                <span key={k} style={{ fontSize: 9, background: S.bg, color: S.textMuted, padding: "2px 5px", borderRadius: 4, border: `1px solid ${S.border}`, whiteSpace: "nowrap" }}>
                                                    {k}
                                                </span>
                                            ))}
                                        </div>
                                    )}

                                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                                        {people.length > 0 && (
                                            <button
                                                onClick={e => { e.stopPropagation(); toggleContactExpand(org.id); }}
                                                style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 9px", borderRadius: 6, border: `1px solid ${isExpanded ? "var(--border-red)" : S.borderLight}`, background: isExpanded ? S.accentGlow : "transparent", color: isExpanded ? "var(--red)" : S.textSecondary, fontSize: 11, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap", transition: "all 0.12s" }}
                                            >
                                                <Users size={11} />
                                                {people.length} {people.length === 1 ? "contact" : "contacts"}
                                                {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                                            </button>
                                        )}

                                        <button
                                            onClick={e => addOrg(org, e)}
                                            disabled={isAdded || isAdding}
                                            className="icp-org-btn"
                                            style={{ background: isAdded ? S.greenBg : isAdding ? S.accentFaint : `linear-gradient(135deg,${S.accent},${S.accentDim})`, color: isAdded ? S.green : isAdding ? "var(--red)" : "white", border: `1.5px solid ${isAdded ? S.greenBorder : isAdding ? "var(--border-red)" : "transparent"}`, borderRadius: 7, padding: "5px 11px", fontSize: 11, fontWeight: 600, cursor: isAdded || isAdding ? "default" : "pointer", whiteSpace: "nowrap", flexShrink: 0, display: "flex", alignItems: "center", gap: 4, minWidth: 68, justifyContent: "center", transition: "all 0.12s" }}
                                        >
                                            {isAdded
                                                ? <><Check size={11} /> Added</>
                                                : isAdding
                                                    ? <><div style={{ width: 10, height: 10, borderRadius: "50%", border: "1.5px solid var(--border-red)", borderTopColor: "var(--red)", animation: "addspin 0.7s linear infinite" }} /> Adding…</>
                                                    : <><Plus size={11} /> Add</>
                                            }
                                        </button>
                                    </div>
                                </div>

                                {org.short_description && !isExpanded && (
                                    <div style={{ fontSize: 11, color: S.textMuted, marginTop: 8, paddingLeft: 26, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                                        {org.short_description}
                                    </div>
                                )}

                                {isExpanded && people.length > 0 && (
                                    <div style={{ marginTop: 10, paddingLeft: 26 }} onClick={e => e.stopPropagation()}>
                                        {people.map((person, idx) => (
                                            <PersonRow
                                                key={idx}
                                                person={person}
                                                orgId={org.id}
                                                orgName={org.name}
                                                org={org}
                                                campaignId={campaignId}
                                                onAddOrgs={onAddOrgs}
                                                added={added}
                                                setAdded={setAdded}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Pagination */}
                {pages > 1 && (
                    <div style={{ background: S.bgMid, borderTop: `1px solid ${S.border}`, padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, flexShrink: 0 }}>
                        <button
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page === 1}
                            style={{ padding: "4px 11px", borderRadius: 6, border: `1px solid ${S.borderLight}`, background: "transparent", fontSize: 12, color: page === 1 ? S.textMuted : S.textSecondary, cursor: page === 1 ? "default" : "pointer" }}
                        >
                            ← Prev
                        </button>
                        {Array.from({ length: pages }, (_, i) => i + 1).map(p => (
                            <button
                                key={p}
                                onClick={() => setPage(p)}
                                style={{ width: 28, height: 28, borderRadius: 6, border: `1px solid ${p === page ? S.accent : S.borderLight}`, background: p === page ? S.accent : "transparent", color: p === page ? "white" : S.textSecondary, fontSize: 12, fontWeight: p === page ? 600 : 400, cursor: "pointer" }}
                            >
                                {p}
                            </button>
                        ))}
                        <button
                            onClick={() => setPage(p => Math.min(pages, p + 1))}
                            disabled={page === pages}
                            style={{ padding: "4px 11px", borderRadius: 6, border: `1px solid ${S.borderLight}`, background: "transparent", fontSize: 12, color: page === pages ? S.textMuted : S.textSecondary, cursor: page === pages ? "default" : "pointer" }}
                        >
                            Next →
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}