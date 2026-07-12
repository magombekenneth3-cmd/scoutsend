"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Spinner } from "@/app/components/ui/Spinner";

const CACHE_TTL = 5 * 60 * 1000;
type CacheEntry<T> = { data: T; ts: number };
const _cache = new Map<string, CacheEntry<unknown>>();

async function cachedFetch<T>(url: string): Promise<T | null> {
    const hit = _cache.get(url);
    if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data as T;
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        _cache.set(url, { data, ts: Date.now() });
        return data as T;
    } catch {
        return null;
    }
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ICPRefinement {
    summary: string;
    industries: string[];
    companySizes: { label: string; range: string }[];
    geographies: string[];
    signals: string[];
    titleKeywords: string[];
    queryVariants: string[];
}

export interface ApolloOrg {
    id: string;
    name: string;
    website_url?: string;
    primary_domain?: string;
    industry?: string;
    estimated_num_employees?: number;
    short_description?: string;
    keywords?: string[];
}

export interface SenderMailbox {
    id: string;
    label: string;
    emailAddress: string;
    health: string;
    dailyLimit: number;
}

export interface LinkedInAccount {
    id: string;
    accountId: string;
    name: string;
    avatarUrl?: string | null;
    profileUrl?: string | null;
}

export interface SenderDomain {
    id: string;
    domain: string;
    health: string;
    dailyLimit: number;
}

export interface Campaign {
    id: string;
    name: string;
    description?: string | null;
    status: string;
    icpDescription: string;
    targetIndustry?: string | null;
    targetRegion?: string | null;
    dailySendLimit: number;
    senderDomainId?: string | null;
    senderMailboxId?: string | null;
    linkedInAccountId?: string | null;
    senderDomain?: { domain: string } | null;
    followUpDelayDays?: number;
    followUpMaxSteps?: number;
    sendWindowStart?: number | null;
    sendWindowEnd?: number | null;
    sendWindowDays?: number[];
    timezone?: string | null;
    leads?: { id: string }[];
    createdAt: string;
    updatedAt: string;
}

type WizardStep = "describe" | "refine" | "results" | "cost" | "launch";

const STEPS: WizardStep[] = ["describe", "refine", "results", "cost", "launch"];
const STEP_LABELS: Record<WizardStep, { title: string; subtitle: string }> = {
    describe: { title: "Details", subtitle: "Name & ICP" },
    refine: { title: "Refine ICP", subtitle: "Target parameters" },
    results: { title: "Select Leads", subtitle: "Apollo matches" },
    cost: { title: "Budget", subtitle: "Cost estimates" },
    launch: { title: "Launch", subtitle: "Send settings" },
};

// ─── Pricing ─────────────────────────────────────────────────────────────────

const PRICE_LINKEDIN = 0.3;
const PRICE_EMAIL = 0.2;
const PRICE_PHONE = 0.6;

// ─── ICP quick-start templates ───────────────────────────────────────────────

const ICP_TEMPLATES = [
    "Series A/B SaaS companies in the US with 50–500 employees",
    "E-commerce brands doing $5M+ annual revenue",
    "FinTech scale-ups in Europe (UK, Germany, France)",
    "Healthcare IT companies with hospital clients",
    "Manufacturing SMBs with 100–500 employees in North America",
];

// ─── Tiny shared atoms ───────────────────────────────────────────────────────


function ChipRemovable({ label, onRemove }: { label: string; onRemove: () => void }) {
    return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-[var(--surface)] border border-[var(--border)] rounded-full text-xs text-[var(--text-secondary)]">
            {label}
            <button
                onClick={onRemove}
                className="text-[var(--text-muted)] hover:text-[var(--red)] transition-colors ml-0.5 focus-visible:outline-none"
                aria-label={`Remove ${label}`}
            >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
            </button>
        </span>
    );
}

function ChipAdd({ onAdd, placeholder }: { onAdd: (v: string) => void; placeholder: string }) {
    const [editing, setEditing] = useState(false);
    const [val, setVal] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    function commit() {
        const trimmed = val.trim();
        if (trimmed) onAdd(trimmed);
        setVal("");
        setEditing(false);
    }

    if (!editing) {
        return (
            <button
                onClick={() => { setEditing(true); setTimeout(() => inputRef.current?.focus(), 30); }}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-[var(--surface)] border border-dashed border-[var(--border)] rounded-full text-xs text-[var(--text-muted)] hover:border-[var(--border-red)] hover:text-[var(--red)] transition-colors"
            >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add
            </button>
        );
    }

    return (
        <input
            ref={inputRef}
            value={val}
            onChange={e => setVal(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") { setEditing(false); setVal(""); } }}
            onBlur={commit}
            placeholder={placeholder}
            className="inline-block w-28 px-2.5 py-1 bg-[var(--surface)] border border-[var(--border-red)] rounded-full text-xs text-[var(--text-primary)] focus:outline-none"
        />
    );
}

// ─── Progress stepper ────────────────────────────────────────────────────────

function WizardProgress({ current }: { current: WizardStep }) {
    const idx = STEPS.indexOf(current);
    return (
        <div className="flex flex-col w-full flex-shrink-0">
            <div className="w-full h-1 bg-[var(--surface-2)] overflow-hidden">
                <div 
                    className="h-full bg-gradient-to-r from-[var(--red-glow)] via-[var(--red)] to-[var(--red)] transition-all duration-500 shadow-[0_0_8px_var(--red)]"
                    style={{ width: `${((idx + 1) / STEPS.length) * 100}%` }}
                />
            </div>
            <div className="relative flex items-center justify-between w-full px-6 py-4 bg-[var(--navy-mid)] border-b border-[var(--border)]">
                <div className="absolute top-[28px] left-[10%] right-[10%] h-[2px] bg-[var(--border)] z-0">
                    <div 
                        className="h-full bg-gradient-to-r from-[var(--red)] to-[var(--red-dim)] transition-all duration-500 shadow-[0_0_8px_var(--red)]"
                        style={{ width: `${(idx / (STEPS.length - 1)) * 100}%` }}
                    />
                </div>
                {STEPS.map((step, i) => {
                    const done = i < idx;
                    const active = i === idx;
                    const label = STEP_LABELS[step];
                    return (
                        <div key={step} className="flex flex-col items-center relative z-10 flex-1">
                            <div className={[
                                "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 relative",
                                done
                                    ? "bg-[var(--red)] text-white shadow-[0_0_10px_var(--red-glow)]"
                                    : active
                                        ? "bg-[var(--navy-mid)] border-2 border-[var(--red)] text-[var(--red)] shadow-[0_0_15px_var(--red-glow)] scale-110"
                                        : "bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-muted)]"
                            ].join(" ")}>
                                {active && (
                                    <span className="absolute inset-0 rounded-full border border-[var(--red)] animate-ping opacity-75" />
                                )}
                                {done ? (
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round">
                                        <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                ) : (
                                    i + 1
                                )}
                            </div>
                            <span className={[
                                "text-[10px] font-semibold tracking-wider uppercase mt-2 transition-colors duration-200",
                                active ? "text-[var(--red)]" : done ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)]"
                            ].join(" ")}>
                                {label.title}
                            </span>
                            <span className="text-[9px] text-[var(--text-muted)] hidden sm:block mt-0.5 max-w-[90px] text-center truncate">
                                {label.subtitle}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Step-specific sub-components ────────────────────────────────────────────

function RefinementSection({
    title,
    items,
    placeholder,
    onRemove,
    onAdd,
}: {
    title: string;
    items: string[];
    placeholder: string;
    onRemove: (v: string) => void;
    onAdd: (v: string) => void;
}) {
    return (
        <div>
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-2">{title}</p>
            <div className="flex flex-wrap gap-1.5 items-center">
                {items.map(item => (
                    <ChipRemovable key={item} label={item} onRemove={() => onRemove(item)} />
                ))}
                <ChipAdd onAdd={onAdd} placeholder={placeholder} />
            </div>
        </div>
    );
}

function OrgCard({ org, selected, onToggle }: { org: ApolloOrg; selected: boolean; onToggle: () => void }) {
    const domain = org.primary_domain ?? org.website_url?.replace(/^https?:\/\/(www\.)?/, "");
    return (
        <button
            onClick={onToggle}
            className={[
                "text-left w-full p-4 rounded-xl border transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]",
                selected
                    ? "bg-[var(--red-glow)] border-[var(--border-red)]"
                    : "bg-[var(--surface-2)] border-[var(--border)] hover:border-[var(--border-red)]/60",
            ].join(" ")}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{org.name}</p>
                    <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                        {org.industry && (
                            <span className="text-xs text-[var(--text-muted)]">{org.industry}</span>
                        )}
                        {org.estimated_num_employees != null && (
                            <span className="text-xs text-[var(--text-muted)]">
                                · {org.estimated_num_employees.toLocaleString()} emp.
                            </span>
                        )}
                        {domain && (
                            <span className="text-xs font-mono text-[var(--text-muted)] truncate max-w-[140px]">
                                · {domain}
                            </span>
                        )}
                    </div>
                    {org.short_description && (
                        <p className="text-xs text-[var(--text-secondary)] mt-1.5 line-clamp-2 leading-relaxed">
                            {org.short_description}
                        </p>
                    )}
                </div>
                <div className={[
                    "flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-all mt-0.5",
                    selected ? "bg-[var(--red)] border-[var(--red)]" : "border-[var(--border)]",
                ].join(" ")}>
                    {selected && (
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round">
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                    )}
                </div>
            </div>
        </button>
    );
}

function CostLine({
    icon,
    label,
    sub,
    count,
    unitCost,
    total,
}: {
    icon: React.ReactNode;
    label: string;
    sub: string;
    count: number;
    unitCost: number;
    total: number;
}) {
    return (
        <div className="flex items-center gap-4 px-4 py-3.5">
            <div className="w-8 h-8 rounded-lg bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center text-[var(--text-secondary)] flex-shrink-0">
                {icon}
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)]">{label}</p>
                <p className="text-xs text-[var(--text-muted)]">{sub}</p>
            </div>
            <div className="text-right flex-shrink-0">
                <p className="text-sm font-semibold text-[var(--text-primary)]">${total.toFixed(2)}</p>
                <p className="text-xs text-[var(--text-muted)]">
                    {count} × ${unitCost.toFixed(2)}
                </p>
            </div>
        </div>
    );
}

function SummaryLine({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
    return (
        <div className="flex items-start justify-between gap-4 py-2 border-b border-[var(--border)] last:border-0">
            <span className="text-xs text-[var(--text-muted)] flex-shrink-0">{label}</span>
            <span className={`text-xs font-medium text-right ${highlight ? "text-[var(--red)]" : "text-[var(--text-primary)]"}`}>
                {value}
            </span>
        </div>
    );
}

// ─── Main wizard ─────────────────────────────────────────────────────────────

interface CampaignWizardProps {
    open: boolean;
    domains: SenderDomain[];
    onClose: () => void;
    onCreated: (c: Campaign) => void;
}

export function CampaignWizard({ open, domains, onClose, onCreated }: CampaignWizardProps) {
    // ── step state ──
    const [step, setStep] = useState<WizardStep>("describe");

    // ── step 1: describe ──
    const [campaignName, setCampaignName] = useState("");
    const [icpText, setIcpText] = useState("");

    // ── step 2: refine ──
    const [refinement, setRefinement] = useState<ICPRefinement | null>(null);
    const [refining, setRefining] = useState(false);
    const [refineError, setRefineError] = useState<string | null>(null);

    // ── step 3: results ──
    const [orgs, setOrgs] = useState<ApolloOrg[]>([]);
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [apolloFailed, setApolloFailed] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    // ── step 5: launch ──
    const [senderDomainId, setSenderDomainId] = useState("");
    const [senderMailboxId, setSenderMailboxId] = useState("");
    const [linkedInAccountId, setLinkedInAccountId] = useState("");
    const [dailyLimit, setDailyLimit] = useState("25");
    const [followUpDelayDays, setFollowUpDelayDays] = useState("3");
    const [followUpMaxSteps, setFollowUpMaxSteps] = useState("2");
    const [sendWindowStart, setSendWindowStart] = useState("8");
    const [sendWindowEnd, setSendWindowEnd] = useState("18");
    const [timezone, setTimezone] = useState("UTC");
    const [sendWindowDays, setSendWindowDays] = useState<number[]>([1, 2, 3, 4, 5]);
    const [launching, setLaunching] = useState(false);
    const [launchError, setLaunchError] = useState<string | null>(null);

    const [mailboxes, setMailboxes] = useState<SenderMailbox[]>([]);
    const [linkedInAccounts, setLinkedInAccounts] = useState<LinkedInAccount[]>([]);

    const [visible, setVisible] = useState(false);
    const dialogRef = useRef<HTMLDialogElement>(null);
    const nameRef = useRef<HTMLInputElement>(null);

    // ── reset on open ──
    useEffect(() => {
        const el = dialogRef.current;
        if (!el) return;
        if (open) {
            setStep("describe");
            setCampaignName("");
            setIcpText("");
            setRefinement(null);
            setRefining(false);
            setRefineError(null);
            setOrgs([]);
            setSearching(false);
            setSearchError(null);
            setSelectedIds(new Set());
            setApolloFailed(false);
            setSenderDomainId("");
            setSenderMailboxId("");
            setLinkedInAccountId("");
            setDailyLimit("25");
            setFollowUpDelayDays("3");
            setFollowUpMaxSteps("2");
            setSendWindowStart("8");
            setSendWindowEnd("18");
            setTimezone("UTC");
            setSendWindowDays([1, 2, 3, 4, 5]);
            setLaunching(false);
            setLaunchError(null);
            if (!el.open) el.showModal();
            requestAnimationFrame(() => {
                setVisible(true);
                setTimeout(() => nameRef.current?.focus(), 60);
            });

            cachedFetch<{ data: SenderMailbox[] }>("/api/sender-mailboxes?limit=100")
                .then(d => { if (d?.data) setMailboxes(d.data); });

            cachedFetch<{ items: LinkedInAccount[] }>("/api/linkedin-accounts?limit=100")
                .then(d => { if (d?.items) setLinkedInAccounts(d.items); });
        } else {
            setVisible(false);
            const timer = setTimeout(() => { if (el.open) el.close(); }, 300);
            return () => clearTimeout(timer);
        }
    }, [open]);

    // ── step nav helpers ──
    function goBack() {
        const i = STEPS.indexOf(step);
        if (i > 0) setStep(STEPS[i - 1] as WizardStep);
    }

    // ── step 1 → 2: refine ICP ──
    async function handleDescribeNext() {
        if (!campaignName.trim() || !icpText.trim() || refining) return;
        setStep("refine");
        setRefining(true);
        setRefineError(null);
        setRefinement(null);
        try {
            const res = await fetch("/api/campaigns/icp-refine", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ icpDescription: icpText }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error ?? "Failed to refine ICP");
            setRefinement(data.refinement);
        } catch (err) {
            setRefineError(err instanceof Error ? err.message : "Something went wrong");
        } finally {
            setRefining(false);
        }
    }

    // ── step 2 → 3: Apollo search ──
    async function handleRefineNext() {
        if (!refinement || searching) return;
        setStep("results");
        setSearching(true);
        setSearchError(null);
        setApolloFailed(false);
        setOrgs([]);
        setSelectedIds(new Set());
        try {
            const res = await fetch("/api/campaigns/apollo-preview", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ refinement }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error ?? "Apollo search failed");
            setOrgs(data.organizations ?? []);
        } catch (err) {
            setSearchError(err instanceof Error ? err.message : "Apollo search failed");
            setApolloFailed(true);
        } finally {
            setSearching(false);
        }
    }

    // ── step 5: launch ──
    async function handleLaunch() {
        if (!campaignName.trim() || !refinement || launching) return;
        setLaunching(true);
        setLaunchError(null);
        try {
            const campaignBody: Record<string, unknown> = {
                name: campaignName.trim(),
                icpDescription: icpText.trim(),
                dailySendLimit: Math.max(1, Number(dailyLimit) || 25),
                targetIndustry: refinement.industries[0] ?? undefined,
                targetRegion: refinement.geographies[0] ?? undefined,
                followUpDelayDays: Math.max(1, Number(followUpDelayDays) || 3),
                followUpMaxSteps: Math.max(0, Number(followUpMaxSteps) || 2),
                timezone: timezone || "UTC",
                enrichmentData: refinement,
            };
            if (senderDomainId) campaignBody.senderDomainId = senderDomainId;
            if (senderMailboxId) campaignBody.senderMailboxId = senderMailboxId;
            if (linkedInAccountId) campaignBody.linkedInAccountId = linkedInAccountId;
            const ws = Number(sendWindowStart);
            const we = Number(sendWindowEnd);
            if (!isNaN(ws) && !isNaN(we) && we > ws) {
                campaignBody.sendWindowStart = ws;
                campaignBody.sendWindowEnd = we;
                campaignBody.sendWindowDays = sendWindowDays;
            }

            const campRes = await fetch("/api/campaigns", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(campaignBody),
            });
            const campData = await campRes.json();
            if (!campRes.ok) throw new Error(campData?.error ?? "Failed to create campaign");

            const selected = orgs.filter(o => selectedIds.has(o.id));
            for (const org of selected) {
                await fetch("/api/leads", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        companyName: org.name,
                        website: org.website_url ?? (org.primary_domain ? `https://${org.primary_domain}` : undefined),
                        campaignId: campData.id,
                        source: "apollo",
                        externalId: org.id,
                    }),
                }).catch(() => {});
            }

            onCreated(campData as Campaign);
        } catch (err) {
            setLaunchError(err instanceof Error ? err.message : "Launch failed");
        } finally {
            setLaunching(false);
        }
    }

    // ── refinement chip editors ──
    function removeChip(
        field: keyof Pick<ICPRefinement, "industries" | "geographies" | "signals" | "titleKeywords">,
        value: string
    ) {
        if (!refinement) return;
        setRefinement({ ...refinement, [field]: refinement[field].filter(v => v !== value) });
    }

    function addChip(
        field: keyof Pick<ICPRefinement, "industries" | "geographies" | "signals" | "titleKeywords">,
        value: string
    ) {
        if (!refinement || refinement[field].includes(value)) return;
        setRefinement({ ...refinement, [field]: [...refinement[field], value] });
    }

    function removeSize(range: string) {
        if (!refinement) return;
        setRefinement({ ...refinement, companySizes: refinement.companySizes.filter(s => s.range !== range) });
    }

    function addSize(label: string) {
        if (!refinement) return;
        const range = label.match(/[\d,]+/)?.join("") ?? label;
        if (refinement.companySizes.some(s => s.label === label)) return;
        setRefinement({ ...refinement, companySizes: [...refinement.companySizes, { label, range }] });
    }

    function toggleOrg(id: string) {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }

    function toggleAll() {
        if (selectedIds.size === orgs.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(orgs.map(o => o.id)));
        }
    }

    // ── cost calc ──
    const n = selectedIds.size;
    const costLI = n * PRICE_LINKEDIN;
    const costEmail = n * PRICE_EMAIL;
    const costPhone = n * PRICE_PHONE;
    const costTotal = costLI + costEmail + costPhone;

    // ── shared input styles ──
    const inputCls =
        "w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)]/20 transition-colors";
    const labelCls = "block text-xs font-medium text-[var(--text-secondary)] mb-1.5";

    const isDirty = campaignName.trim() !== "" || orgs.length > 0 || icpText.trim() !== "";

    useEffect(() => {
        if (!isDirty) return;
        const fn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
        window.addEventListener("beforeunload", fn);
        return () => window.removeEventListener("beforeunload", fn);
    }, [isDirty]);

    function requestClose() {
        if (isDirty && !window.confirm("You have unsaved campaign progress. Leave anyway?")) return;
        onClose();
    }

    function handleCancel(e: React.SyntheticEvent) {
        e.preventDefault();
        requestClose();
    }

    if (!open) return null;

    return (
        <dialog
            ref={dialogRef}
            onCancel={handleCancel}
            aria-label="New campaign wizard"
            className="sheet-panel"
        >
            <div
                className="absolute inset-0 bg-black/50 transition-opacity"
                onClick={requestClose}
                aria-hidden="true"
            />

            <aside
                className={[
                    "absolute top-0 right-0 h-full w-[620px] max-w-full",
                    "bg-[var(--navy-mid)] border-l border-[var(--border)]",
                    "flex flex-col shadow-2xl",
                    "transition-transform duration-300 ease-in-out",
                    visible ? "translate-x-0" : "translate-x-full",
                ].join(" ")}
            >
                {/* Header */}
                <div className="flex items-center justify-between h-14 px-5 border-b border-[var(--border)] flex-shrink-0">
                    <div className="flex items-center gap-2.5">
                        <div className="w-6 h-6 rounded-md bg-[var(--red-glow)] border border-[var(--border-red)] flex items-center justify-center">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2.5" strokeLinecap="round">
                                <circle cx="11" cy="11" r="8" />
                                <path d="m21 21-4.35-4.35" />
                                <line x1="11" y1="8" x2="11" y2="14" />
                                <line x1="8" y1="11" x2="14" y2="11" />
                            </svg>
                        </div>
                        <h2 className="text-sm font-semibold font-display text-[var(--text-primary)]">
                            New Campaign
                        </h2>
                    </div>
                    <button
                        onClick={requestClose}
                        aria-label="Close"
                        className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                {/* Stepper */}
                <WizardProgress current={step} />

                {/* Scrollable body */}
                <div className="flex-1 overflow-y-auto">

                    {/* ───────── STEP 1: DESCRIBE ───────── */}
                    {step === "describe" && (
                        <div className="p-6 space-y-5">
                            <div>
                                <h3 className="text-base font-semibold text-[var(--text-primary)]">Who's your perfect customer?</h3>
                                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                                    Describe them naturally — industry, size, pain points. We'll structure it and find real matches.
                                </p>
                            </div>

                            <div>
                                <label className={labelCls} htmlFor="wiz-name">
                                    Campaign name <span className="text-[var(--red)]">*</span>
                                </label>
                                <input
                                    ref={nameRef}
                                    id="wiz-name"
                                    type="text"
                                    className={inputCls}
                                    placeholder="Q3 SaaS Outreach"
                                    value={campaignName}
                                    onChange={e => setCampaignName(e.target.value)}
                                    onKeyDown={e => { if (e.key === "Enter") handleDescribeNext(); }}
                                />
                            </div>

                            <div>
                                <label className={labelCls} htmlFor="wiz-icp">
                                    ICP description <span className="text-[var(--red)]">*</span>
                                </label>
                                <textarea
                                    id="wiz-icp"
                                    rows={7}
                                    className={`${inputCls} resize-none leading-relaxed`}
                                    placeholder={`e.g. Series B SaaS companies in the US with 50–500 employees, focused on developer tools. Decision makers are CTOs and VPs of Engineering who struggle with deployment complexity and want to cut infrastructure costs…`}
                                    value={icpText}
                                    onChange={e => setIcpText(e.target.value)}
                                />
                            </div>

                            <div>
                                <p className="text-xs text-[var(--text-muted)] mb-2.5">Quick-start templates</p>
                                <div className="flex flex-wrap gap-2">
                                    {ICP_TEMPLATES.map(t => (
                                        <button
                                            key={t}
                                            onClick={() => setIcpText(t)}
                                            className="text-xs px-2.5 py-1 bg-[var(--surface-2)] border border-[var(--border)] rounded-full text-[var(--text-secondary)] hover:border-[var(--border-red)] hover:text-[var(--red)] transition-colors"
                                        >
                                            {t}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ───────── STEP 2: REFINE ───────── */}
                    {step === "refine" && (
                        <div className="p-6 space-y-5">
                            {refining ? (
                                <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
                                    <div className="w-12 h-12 rounded-full bg-[var(--red-glow)] border border-[var(--border-red)] flex items-center justify-center text-[var(--red)]">
                                        <Spinner size={20} />
                                    </div>
                                    <p className="text-sm font-semibold text-[var(--text-primary)]">Analyzing your ICP…</p>
                                    <p className="text-xs text-[var(--text-muted)]">Extracting industries, company sizes, buying signals</p>
                                </div>
                            ) : refineError ? (
                                <div className="flex flex-col items-center gap-3 py-14 text-center">
                                    <div className="p-3 bg-[var(--red-glow)] border border-[var(--border-red)] rounded-xl">
                                        <p className="text-sm text-[var(--red)]">{refineError}</p>
                                    </div>
                                    <button onClick={() => setStep("describe")} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                                        ← Edit description
                                    </button>
                                </div>
                            ) : refinement ? (
                                <>
                                    <div>
                                        <h3 className="text-base font-semibold text-[var(--text-primary)] mb-2">Here's how we read your ICP</h3>
                                        <div className="p-3 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg">
                                            <p className="text-xs text-[var(--text-secondary)] leading-relaxed italic">
                                                "{refinement.summary}"
                                            </p>
                                        </div>
                                    </div>

                                    <p className="text-xs text-[var(--text-muted)]">
                                        Review and edit these targeting parameters before we search Apollo. Click chips to remove, or add new ones.
                                    </p>

                                    <RefinementSection
                                        title="Industries"
                                        items={refinement.industries}
                                        placeholder="e.g. FinTech"
                                        onRemove={v => removeChip("industries", v)}
                                        onAdd={v => addChip("industries", v)}
                                    />

                                    <div>
                                        <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-2">Company sizes</p>
                                        <div className="flex flex-wrap gap-1.5 items-center">
                                            {refinement.companySizes.map(s => (
                                                <ChipRemovable key={s.range} label={s.label} onRemove={() => removeSize(s.range)} />
                                            ))}
                                            <ChipAdd onAdd={addSize} placeholder="e.g. 500–1000" />
                                        </div>
                                    </div>

                                    <RefinementSection
                                        title="Geographies"
                                        items={refinement.geographies}
                                        placeholder="e.g. Canada"
                                        onRemove={v => removeChip("geographies", v)}
                                        onAdd={v => addChip("geographies", v)}
                                    />

                                    <RefinementSection
                                        title="Buying signals"
                                        items={refinement.signals}
                                        placeholder="e.g. Recently hired VP Sales"
                                        onRemove={v => removeChip("signals", v)}
                                        onAdd={v => addChip("signals", v)}
                                    />

                                    <RefinementSection
                                        title="Decision-maker titles"
                                        items={refinement.titleKeywords}
                                        placeholder="e.g. CRO"
                                        onRemove={v => removeChip("titleKeywords", v)}
                                        onAdd={v => addChip("titleKeywords", v)}
                                    />
                                </>
                            ) : null}
                        </div>
                    )}

                    {/* ───────── STEP 3: RESULTS ───────── */}
                    {step === "results" && (
                        <div className="p-6 space-y-4">
                            {searching ? (
                                <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
                                    <div className="w-12 h-12 rounded-full bg-[var(--red-glow)] border border-[var(--border-red)] flex items-center justify-center text-[var(--red)]">
                                        <Spinner size={20} />
                                    </div>
                                    <p className="text-sm font-semibold text-[var(--text-primary)]">Searching Apollo…</p>
                                    <p className="text-xs text-[var(--text-muted)]">Finding companies that match your ICP</p>
                                </div>
                            ) : searchError ? (
                                <div className="flex flex-col items-center gap-4 py-14 text-center">
                                    <div className="p-3 bg-[var(--red-glow)] border border-[var(--border-red)] rounded-xl max-w-xs">
                                        <p className="text-sm font-semibold text-[var(--red)] mb-1">Apollo unavailable</p>
                                        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{searchError}</p>
                                    </div>
                                    <p className="text-xs text-[var(--text-muted)] max-w-[260px] leading-relaxed">
                                        You can still create the campaign — leads can be added manually or via ICP Search later.
                                    </p>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setStep("refine")}
                                            className="text-xs px-3 py-2 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                                        >
                                            ← Adjust ICP
                                        </button>
                                        <button
                                            onClick={() => setStep("cost")}
                                            className="text-xs px-3 py-2 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] transition-colors font-semibold"
                                        >
                                            Skip &rarr; Create campaign
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                                                {orgs.length} companies found
                                            </h3>
                                            <p className="text-xs text-[var(--text-muted)]">Select the ones you want in this campaign</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {n > 0 && (
                                                <span className="text-xs font-medium px-2.5 py-1 bg-[var(--red-glow)] border border-[var(--border-red)] text-[var(--red)] rounded-full">
                                                    {n} selected
                                                </span>
                                            )}
                                            {orgs.length > 0 && (
                                                <button
                                                    onClick={toggleAll}
                                                    className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors whitespace-nowrap"
                                                >
                                                    {n === orgs.length ? "Deselect all" : "Select all"}
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {orgs.length === 0 ? (
                                        <div className="flex flex-col items-center gap-4 py-14 text-center">
                                            <div className="w-10 h-10 rounded-full bg-[var(--surface-2)] flex items-center justify-center text-[var(--text-muted)]">
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-[var(--text-secondary)]">No companies found</p>
                                                <p className="text-xs text-[var(--text-muted)] mt-1 max-w-[240px] leading-relaxed">
                                                    Apollo didn't return matches for these filters. You can refine your ICP or create the campaign and add leads later.
                                                </p>
                                            </div>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => setStep("refine")}
                                                    className="text-xs px-3 py-2 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                                                >
                                                    ← Refine ICP
                                                </button>
                                                <button
                                                    onClick={() => setStep("cost")}
                                                    className="text-xs px-3 py-2 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] transition-colors font-semibold"
                                                >
                                                    Create campaign anyway →
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-2.5">
                                            {orgs.map(org => (
                                                <OrgCard
                                                    key={org.id}
                                                    org={org}
                                                    selected={selectedIds.has(org.id)}
                                                    onToggle={() => toggleOrg(org.id)}
                                                />
                                            ))}
                                            <button
                                                onClick={() => setStep("refine")}
                                                className="w-full py-2.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-dashed border-[var(--border)] rounded-xl transition-colors"
                                            >
                                                Not seeing the right companies? ← Refine ICP
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {/* ───────── STEP 4: COST ESTIMATE ───────── */}
                    {step === "cost" && (
                        <div className="p-6 space-y-5">
                            <div>
                                <h3 className="text-base font-semibold text-[var(--text-primary)]">Enrichment cost estimate</h3>
                                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                                    Approximate cost to enrich contacts for{" "}
                                    <span className="text-[var(--text-primary)] font-medium">
                                        {n} {n === 1 ? "company" : "companies"}
                                    </span>
                                    .
                                </p>
                            </div>

                            <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl overflow-hidden">
                                <div className="divide-y divide-[var(--border)]">
                                    <CostLine
                                        icon={
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                                                <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
                                                <rect x="2" y="9" width="4" height="12" />
                                                <circle cx="4" cy="4" r="2" />
                                            </svg>
                                        }
                                        label="LinkedIn profile data"
                                        sub="Decision-maker profiles, seniority, career history"
                                        count={n}
                                        unitCost={PRICE_LINKEDIN}
                                        total={costLI}
                                    />
                                    <CostLine
                                        icon={
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                                                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                                                <polyline points="22,6 12,13 2,6" />
                                            </svg>
                                        }
                                        label="Verified email addresses"
                                        sub="Deliverability-verified work emails per contact"
                                        count={n}
                                        unitCost={PRICE_EMAIL}
                                        total={costEmail}
                                    />
                                    <CostLine
                                        icon={
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                                                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.73a16 16 0 0 0 6 6l.85-.85a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                                            </svg>
                                        }
                                        label="Phone / mobile contacts"
                                        sub="Direct dial and mobile numbers per contact"
                                        count={n}
                                        unitCost={PRICE_PHONE}
                                        total={costPhone}
                                    />
                                </div>

                                <div className="flex items-center justify-between px-4 py-3.5 bg-[var(--surface)] border-t border-[var(--border)]">
                                    <div>
                                        <p className="text-sm font-semibold text-[var(--text-primary)]">Total estimate</p>
                                        <p className="text-xs text-[var(--text-muted)]">for {n} {n === 1 ? "company" : "companies"}</p>
                                    </div>
                                    <p className="text-xl font-bold text-[var(--red)]">${costTotal.toFixed(2)}</p>
                                </div>
                            </div>

                            <div className="flex items-start gap-2.5 p-3.5 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl">
                                <svg className="flex-shrink-0 mt-0.5 text-[var(--text-muted)]" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                    <circle cx="12" cy="12" r="10" />
                                    <line x1="12" y1="8" x2="12" y2="12" />
                                    <line x1="12" y1="16" x2="12.01" y2="16" />
                                </svg>
                                <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                                    Costs are approximate and depend on data availability per contact. Enrichment runs in the background after the campaign is created — you'll only be charged for data that's found.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* ───────── STEP 5: LAUNCH ───────── */}
                    {step === "launch" && (
                        <div className="p-6 space-y-5">
                            <div>
                                <h3 className="text-base font-semibold text-[var(--text-primary)]">Review & launch</h3>
                                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                                    Configure sending preferences and create the campaign.
                                </p>
                            </div>

                            <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4">
                                <SummaryLine label="Campaign" value={campaignName} />
                                <SummaryLine label="Companies selected" value={`${n} leads`} highlight />
                                <SummaryLine label="ICP summary" value={refinement?.summary ?? icpText} />
                                <SummaryLine label="Enrichment budget" value={`~$${costTotal.toFixed(2)}`} />
                            </div>

                            <div className="space-y-4">
                                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest">Sender</p>

                                <div>
                                    <label className={labelCls} htmlFor="wiz-domain">Sender domain</label>
                                    <select
                                        id="wiz-domain"
                                        className={`${inputCls} cursor-pointer`}
                                        value={senderDomainId}
                                        onChange={e => setSenderDomainId(e.target.value)}
                                    >
                                        <option value="">None</option>
                                        {domains.map(d => (
                                            <option key={d.id} value={d.id} disabled={d.health === "BLOCKED"}>
                                                {d.domain}{d.health === "BLOCKED" ? " (blocked)" : ""}
                                            </option>
                                        ))}
                                    </select>
                                    {domains.length === 0 && (
                                        <p className="mt-1 text-xs text-[var(--text-muted)]">
                                            No sender domains.{" "}
                                            <Link href="/dashboard/domains" className="text-[var(--red)] hover:underline">Add one →</Link>
                                        </p>
                                    )}
                                </div>

                                <div>
                                    <label className={labelCls} htmlFor="wiz-mailbox">Sender mailbox</label>
                                    <select
                                        id="wiz-mailbox"
                                        className={`${inputCls} cursor-pointer`}
                                        value={senderMailboxId}
                                        onChange={e => setSenderMailboxId(e.target.value)}
                                    >
                                        <option value="">None</option>
                                        {mailboxes.map(m => (
                                            <option key={m.id} value={m.id} disabled={m.health === "BLOCKED"}>
                                                {m.label} — {m.emailAddress}{m.health === "BLOCKED" ? " (blocked)" : ""}
                                            </option>
                                        ))}
                                    </select>
                                    {mailboxes.length === 0 && (
                                        <p className="mt-1 text-xs text-[var(--text-muted)]">
                                            No mailboxes.{" "}
                                            <Link href="/settings/accounts" className="text-[var(--red)] hover:underline">Add one →</Link>
                                        </p>
                                    )}
                                </div>

                                <div>
                                    <label className={labelCls} htmlFor="wiz-li-account">LinkedIn account</label>
                                    <select
                                        id="wiz-li-account"
                                        className={`${inputCls} cursor-pointer`}
                                        value={linkedInAccountId}
                                        onChange={e => setLinkedInAccountId(e.target.value)}
                                    >
                                        <option value="">None (email only)</option>
                                        {linkedInAccounts.map(a => (
                                            <option key={a.id} value={a.accountId}>
                                                {a.name}
                                            </option>
                                        ))}
                                    </select>
                                    {linkedInAccounts.length === 0 && (
                                        <p className="mt-1 text-xs text-[var(--text-muted)]">
                                            No LinkedIn accounts.{" "}
                                            <Link href="/settings/accounts" className="text-[var(--red)] hover:underline">Connect one →</Link>
                                        </p>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-4">
                                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest">Sequence</p>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className={labelCls} htmlFor="wiz-delay">Follow-up delay (days)</label>
                                        <input
                                            id="wiz-delay"
                                            type="number" min={1} max={30}
                                            className={inputCls}
                                            value={followUpDelayDays}
                                            onChange={e => setFollowUpDelayDays(e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelCls} htmlFor="wiz-steps">Max follow-up steps</label>
                                        <input
                                            id="wiz-steps"
                                            type="number" min={0} max={10}
                                            className={inputCls}
                                            value={followUpMaxSteps}
                                            onChange={e => setFollowUpMaxSteps(e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className={labelCls} htmlFor="wiz-limit">Daily send limit</label>
                                    <input
                                        id="wiz-limit"
                                        type="number" min={1} max={10000}
                                        className={inputCls}
                                        value={dailyLimit}
                                        onChange={e => setDailyLimit(e.target.value)}
                                    />
                                </div>
                            </div>

                            <div className="space-y-4">
                                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest">Send window</p>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className={labelCls} htmlFor="wiz-win-start">Start hour (0–23)</label>
                                        <input
                                            id="wiz-win-start"
                                            type="number" min={0} max={23}
                                            className={inputCls}
                                            value={sendWindowStart}
                                            onChange={e => setSendWindowStart(e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelCls} htmlFor="wiz-win-end">End hour (0–23)</label>
                                        <input
                                            id="wiz-win-end"
                                            type="number" min={0} max={23}
                                            className={inputCls}
                                            value={sendWindowEnd}
                                            onChange={e => setSendWindowEnd(e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className={labelCls}>Active days</label>
                                    <div className="flex gap-1.5 flex-wrap">
                                        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, i) => {
                                            const dayNum = i + 1;
                                            const active = sendWindowDays.includes(dayNum);
                                            return (
                                                <button
                                                    key={day}
                                                    type="button"
                                                    onClick={() => setSendWindowDays(prev =>
                                                        active ? prev.filter(d => d !== dayNum) : [...prev, dayNum].sort()
                                                    )}
                                                    className={[
                                                        "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                                                        active
                                                            ? "bg-[var(--red-glow)] border-[var(--border-red)] text-[var(--red)]"
                                                            : "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--border-red)]/60",
                                                    ].join(" ")}
                                                >
                                                    {day}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div>
                                    <label className={labelCls} htmlFor="wiz-tz">Timezone</label>
                                    <select
                                        id="wiz-tz"
                                        className={`${inputCls} cursor-pointer`}
                                        value={timezone}
                                        onChange={e => setTimezone(e.target.value)}
                                    >
                                        {[
                                            "UTC",
                                            "America/New_York",
                                            "America/Chicago",
                                            "America/Denver",
                                            "America/Los_Angeles",
                                            "Europe/London",
                                            "Europe/Paris",
                                            "Europe/Berlin",
                                            "Asia/Dubai",
                                            "Asia/Kolkata",
                                            "Asia/Singapore",
                                            "Asia/Tokyo",
                                            "Australia/Sydney",
                                        ].map(tz => (
                                            <option key={tz} value={tz}>{tz}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {launchError && (
                                <div className="flex items-start gap-2 p-3 bg-[var(--red-glow)] border border-[var(--border-red)] rounded-xl">
                                    <svg className="flex-shrink-0 mt-0.5 text-[var(--red)]" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                        <circle cx="12" cy="12" r="10" />
                                        <line x1="12" y1="8" x2="12" y2="12" />
                                        <line x1="12" y1="16" x2="12.01" y2="16" />
                                    </svg>
                                    <p className="text-xs text-[var(--red)]">{launchError}</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* ── Footer buttons ── */}
                <div className="flex items-center gap-3 px-5 py-4 border-t border-[var(--border)] flex-shrink-0">
                    <button
                        onClick={step === "describe" ? onClose : goBack}
                        disabled={refining || searching || launching}
                        className="h-10 px-4 rounded-lg text-sm font-medium text-[var(--text-secondary)] bg-[var(--surface-2)] hover:bg-[var(--surface)] border border-[var(--border)] transition-colors disabled:opacity-40"
                    >
                        {step === "describe" ? "Cancel" : "← Back"}
                    </button>

                    {step === "describe" && (
                        <button
                            disabled={!campaignName.trim() || !icpText.trim()}
                            onClick={handleDescribeNext}
                            className="flex-1 h-10 rounded-lg text-sm font-semibold text-white bg-[var(--red)] hover:bg-[var(--red-dim)] disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                        >
                            Analyze ICP →
                        </button>
                    )}

                    {step === "refine" && (
                        <button
                            disabled={!refinement || refining}
                            onClick={handleRefineNext}
                            className="flex-1 h-10 rounded-lg text-sm font-semibold text-white bg-[var(--red)] hover:bg-[var(--red-dim)] disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                        >
                            Search Apollo →
                        </button>
                    )}

                    {step === "results" && (
                        <button
                            disabled={searching}
                            onClick={() => setStep("cost")}
                            className="flex-1 h-10 rounded-lg text-sm font-semibold text-white bg-[var(--red)] hover:bg-[var(--red-dim)] disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                        >
                            {apolloFailed || orgs.length === 0
                                ? "Create campaign without leads →"
                                : `Continue with ${n} ${n === 1 ? "company" : "companies"} →`}
                        </button>
                    )}

                    {step === "cost" && (
                        <button
                            onClick={() => setStep("launch")}
                            className="flex-1 h-10 rounded-lg text-sm font-semibold text-white bg-[var(--red)] hover:bg-[var(--red-dim)] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                        >
                            Configure & launch →
                        </button>
                    )}

                    {step === "launch" && (
                        <button
                            disabled={launching || !campaignName.trim()}
                            onClick={handleLaunch}
                            className="flex-1 h-10 rounded-lg text-sm font-semibold text-white bg-[var(--red)] hover:bg-[var(--red-dim)] disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                        >
                            {launching ? (
                                <><Spinner size={13} /> Creating campaign…</>
                            ) : (
                                <>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                        <path d="M5 12h14M12 5l7 7-7 7" />
                                    </svg>
                                    Launch Campaign
                                </>
                            )}
                        </button>
                    )}
                </div>
            </aside>
        </dialog>
    );
}