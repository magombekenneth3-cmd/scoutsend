"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { TopBar } from "@/app/components/dashboard/TopBar";

interface CampaignData {
    id: string;
    name: string;
    description: string | null;
    icpDescription: string | null;
    targetIndustry: string | null;
    targetRegion: string | null;
    dailySendLimit: number;
    senderDomainId: string | null;
    senderMailboxId: string | null;
    linkedInAccountId: string | null;
    followUpDelayDays: number;
    followUpMaxSteps: number;
    sendWindowStart: number;
    sendWindowEnd: number;
    sendWindowDays: number[];
    timezone: string;
    autoSendRepliesEnabled: boolean;
    enrichmentData?: {
        summary?: string;
        industries?: string[];
        geographies?: string[];
        signals?: string[];
        titleKeywords?: string[];
        companySizes?: { label: string; range: string }[];
        queryVariants?: string[];
    } | null;
}

interface OptionItem {
    id: string;
    domain?: string;
    emailAddress?: string;
    name?: string;
    label?: string;
    accountId?: string;
}

export default function CampaignEditPage() {
    const params = useParams();
    const router = useRouter();
    const id = typeof params.id === "string" ? params.id : "";

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);

    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [icpDescription, setIcpDescription] = useState("");
    const [targetIndustry, setTargetIndustry] = useState("");
    const [targetRegion, setTargetRegion] = useState("");
    const [dailySendLimit, setDailySendLimit] = useState("25");
    const [senderDomainId, setSenderDomainId] = useState("");
    const [senderMailboxId, setSenderMailboxId] = useState("");
    const [linkedInAccountId, setLinkedInAccountId] = useState("");
    const [followUpDelayDays, setFollowUpDelayDays] = useState("3");
    const [followUpMaxSteps, setFollowUpMaxSteps] = useState("2");
    const [sendWindowStart, setSendWindowStart] = useState("8");
    const [sendWindowEnd, setSendWindowEnd] = useState("18");
    const [sendWindowDays, setSendWindowDays] = useState<number[]>([1, 2, 3, 4, 5]);
    const [timezone, setTimezone] = useState("UTC");
    const [autoSendRepliesEnabled, setAutoSendRepliesEnabled] = useState(false);

    const [domains, setDomains] = useState<OptionItem[]>([]);
    const [mailboxes, setMailboxes] = useState<OptionItem[]>([]);
    const [linkedInAccounts, setLinkedInAccounts] = useState<OptionItem[]>([]);
    const [enrichmentData, setEnrichmentData] = useState<CampaignData["enrichmentData"]>(null);

    useEffect(() => {
        if (!id) return;

        async function load() {
            setLoading(true);
            setError(null);
            try {
                const [cRes, dRes, mRes, lRes] = await Promise.all([
                    fetch(`/api/campaigns/${id}`),
                    fetch("/api/sender-domains?limit=100"),
                    fetch("/api/sender-mailboxes?limit=100"),
                    fetch("/api/linkedin-accounts?limit=100")
                ]);

                if (!cRes.ok) throw new Error("Failed to load campaign data");
                const cData: CampaignData = await cRes.json();

                const dData = dRes.ok ? await dRes.json() : { data: [] };
                const mData = mRes.ok ? await mRes.json() : { data: [] };
                const lData = lRes.ok ? await lRes.json() : { items: [] };

                setDomains(dData.data ?? []);
                setMailboxes(mData.data ?? []);
                setLinkedInAccounts(lData.items ?? []);

                setName(cData.name || "");
                setDescription(cData.description || "");
                setIcpDescription(cData.icpDescription || "");
                setTargetIndustry(cData.targetIndustry || "");
                setTargetRegion(cData.targetRegion || "");
                setDailySendLimit(String(cData.dailySendLimit ?? 25));
                setSenderDomainId(cData.senderDomainId || "");
                setSenderMailboxId(cData.senderMailboxId || "");
                setLinkedInAccountId(cData.linkedInAccountId || "");
                setFollowUpDelayDays(String(cData.followUpDelayDays ?? 3));
                setFollowUpMaxSteps(String(cData.followUpMaxSteps ?? 2));
                setSendWindowStart(String(cData.sendWindowStart ?? 8));
                setSendWindowEnd(String(cData.sendWindowEnd ?? 18));
                setSendWindowDays(cData.sendWindowDays ?? [1, 2, 3, 4, 5]);
                setTimezone(cData.timezone || "UTC");
                setAutoSendRepliesEnabled(cData.autoSendRepliesEnabled ?? false);
                setEnrichmentData(cData.enrichmentData ?? null);

            } catch (err) {
                setError(err instanceof Error ? err.message : "Something went wrong");
            } finally {
                setLoading(false);
            }
        }

        load();
    }, [id]);

    async function handleSave(e: React.FormEvent) {
        e.preventDefault();
        if (saving) return;
        setSaving(true);
        setSaveError(null);

        try {
            const body: Record<string, unknown> = {
                name: name.trim(),
                description: description.trim() || null,
                icpDescription: icpDescription.trim() || null,
                targetIndustry: targetIndustry.trim() || null,
                targetRegion: targetRegion.trim() || null,
                dailySendLimit: Math.max(1, Number(dailySendLimit) || 25),
                senderDomainId: senderDomainId || null,
                senderMailboxId: senderMailboxId || null,
                linkedInAccountId: linkedInAccountId || null,
                followUpDelayDays: Math.max(1, Number(followUpDelayDays) || 3),
                followUpMaxSteps: Math.max(0, Number(followUpMaxSteps) || 2),
                sendWindowStart: Math.max(0, Math.min(23, Number(sendWindowStart) || 8)),
                sendWindowEnd: Math.max(0, Math.min(23, Number(sendWindowEnd) || 18)),
                sendWindowDays,
                timezone,
                autoSendRepliesEnabled,
            };

            const res = await fetch(`/api/campaigns/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.error ?? "Failed to save campaign");
            }

            router.push(`/dashboard/campaigns/${id}`);
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : "Failed to save campaign");
        } finally {
            setSaving(false);
        }
    }

    const inputCls =
        "w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)]/20 transition-colors";
    const labelCls = "block text-xs font-medium text-[var(--text-secondary)] mb-1.5";

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="flex flex-col items-center gap-3">
                    <svg className="animate-spin text-[var(--red)]" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    <p className="text-sm text-[var(--text-muted)]">Loading campaign settings…</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-center space-y-3">
                    <p className="text-sm font-medium text-[var(--text-secondary)]">{error}</p>
                    <Link href="/dashboard/campaigns" className="text-xs text-[var(--red)] hover:underline">
                        &larr; Back to Campaigns
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <TopBar
                title="Edit Campaign"
                breadcrumbs={[
                    { label: "Campaigns", href: "/dashboard/campaigns" },
                    { label: name || "Campaign", href: `/dashboard/campaigns/${id}` }
                ]}
            />

            <div className="flex-1 overflow-y-auto p-6 max-w-3xl w-full mx-auto">
                <form onSubmit={handleSave} className="space-y-6 pb-12">
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4">
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Campaign Info</h3>

                        <div>
                            <label className={labelCls} htmlFor="edit-name">Campaign Name *</label>
                            <input
                                id="edit-name"
                                type="text"
                                className={inputCls}
                                required
                                value={name}
                                onChange={e => setName(e.target.value)}
                            />
                        </div>

                        <div>
                            <label className={labelCls} htmlFor="edit-description">Description</label>
                            <textarea
                                id="edit-description"
                                rows={3}
                                className={`${inputCls} resize-none leading-relaxed`}
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4">
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">ICP & Targeting</h3>

                        <div>
                            <label className={labelCls} htmlFor="edit-icp">ICP Description *</label>
                            <textarea
                                id="edit-icp"
                                rows={5}
                                className={`${inputCls} resize-none leading-relaxed`}
                                required
                                value={icpDescription}
                                onChange={e => setIcpDescription(e.target.value)}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className={labelCls} htmlFor="edit-industry">Target Industry</label>
                                <input
                                    id="edit-industry"
                                    type="text"
                                    className={inputCls}
                                    value={targetIndustry}
                                    onChange={e => setTargetIndustry(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className={labelCls} htmlFor="edit-region">Target Region</label>
                                <input
                                    id="edit-region"
                                    type="text"
                                    className={inputCls}
                                    value={targetRegion}
                                    onChange={e => setTargetRegion(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4">
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Sender Configuration</h3>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className={labelCls} htmlFor="edit-domain">Sender Domain</label>
                                <select
                                    id="edit-domain"
                                    className={`${inputCls} cursor-pointer`}
                                    value={senderDomainId}
                                    onChange={e => setSenderDomainId(e.target.value)}
                                >
                                    <option value="">None</option>
                                    {domains.map(d => (
                                        <option key={d.id} value={d.id}>{d.domain}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className={labelCls} htmlFor="edit-mailbox">Sender Mailbox</label>
                                <select
                                    id="edit-mailbox"
                                    className={`${inputCls} cursor-pointer`}
                                    value={senderMailboxId}
                                    onChange={e => setSenderMailboxId(e.target.value)}
                                >
                                    <option value="">None</option>
                                    {mailboxes.map(m => (
                                        <option key={m.id} value={m.id}>{m.emailAddress}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className={labelCls} htmlFor="edit-linkedin">LinkedIn Account</label>
                                <select
                                    id="edit-linkedin"
                                    className={`${inputCls} cursor-pointer`}
                                    value={linkedInAccountId}
                                    onChange={e => setLinkedInAccountId(e.target.value)}
                                >
                                    <option value="">None</option>
                                    {linkedInAccounts.map(l => (
                                        <option key={l.id} value={l.accountId ?? l.id}>{l.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className={labelCls} htmlFor="edit-limit">Daily Send Limit</label>
                                <input
                                    id="edit-limit"
                                    type="number"
                                    className={inputCls}
                                    value={dailySendLimit}
                                    onChange={e => setDailySendLimit(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4">
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Sequence & Schedule</h3>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className={labelCls} htmlFor="edit-delay">Follow-up Delay (Days)</label>
                                <input
                                    id="edit-delay"
                                    type="number"
                                    className={inputCls}
                                    value={followUpDelayDays}
                                    onChange={e => setFollowUpDelayDays(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className={labelCls} htmlFor="edit-steps">Max Follow-up Steps</label>
                                <input
                                    id="edit-steps"
                                    type="number"
                                    className={inputCls}
                                    value={followUpMaxSteps}
                                    onChange={e => setFollowUpMaxSteps(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className={labelCls} htmlFor="edit-start">Send Window Start Hour</label>
                                <input
                                    id="edit-start"
                                    type="number"
                                    min={0}
                                    max={23}
                                    className={inputCls}
                                    value={sendWindowStart}
                                    onChange={e => setSendWindowStart(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className={labelCls} htmlFor="edit-end">Send Window End Hour</label>
                                <input
                                    id="edit-end"
                                    type="number"
                                    min={0}
                                    max={23}
                                    className={inputCls}
                                    value={sendWindowEnd}
                                    onChange={e => setSendWindowEnd(e.target.value)}
                                />
                            </div>
                        </div>

                        <div>
                            <label className={labelCls}>Active Days</label>
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
                            <label className={labelCls} htmlFor="edit-tz">Timezone</label>
                            <select
                                id="edit-tz"
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

                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4">
                        <div>
                            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Reply Automation</h3>
                            <p className="text-xs text-[var(--text-muted)] mt-1">When enabled, high-confidence AI reply drafts are sent automatically without requiring manual approval.</p>
                        </div>
                        <button
                            id="toggle-auto-send-replies"
                            type="button"
                            role="switch"
                            aria-checked={autoSendRepliesEnabled}
                            onClick={() => setAutoSendRepliesEnabled(v => !v)}
                            className={[
                                "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--navy-mid)]",
                                autoSendRepliesEnabled
                                    ? "bg-emerald-500 border-emerald-500"
                                    : "bg-[var(--surface-2)] border-[var(--border)]",
                            ].join(" ")}
                        >
                            <span
                                aria-hidden="true"
                                className={[
                                    "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                                    autoSendRepliesEnabled ? "translate-x-5" : "translate-x-0",
                                ].join(" ")}
                            />
                        </button>
                        <p className="text-xs font-medium mt-1 "
                            style={{ color: autoSendRepliesEnabled ? "rgb(52 211 153)" : "var(--text-muted)" }}
                        >
                            {autoSendRepliesEnabled ? "Auto-send enabled" : "Manual approval required"}
                        </p>
                    </div>

                    {saveError && (
                        <div className="flex items-start gap-2 p-3 bg-[var(--red-glow)] border border-[var(--border-red)] rounded-xl">
                            <svg className="flex-shrink-0 mt-0.5 text-[var(--red)]" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="12" y1="8" x2="12" y2="12" />
                                <line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                            <p className="text-xs text-[var(--red)]">{saveError}</p>
                        </div>
                    )}

                    <div className="flex items-center gap-3 justify-end">
                        <button
                            type="button"
                            onClick={() => router.push(`/dashboard/campaigns/${id}`)}
                            disabled={saving}
                            className="h-10 px-4 rounded-lg text-sm font-medium text-[var(--text-secondary)] bg-[var(--surface-2)] hover:bg-[var(--surface)] border border-[var(--border)] transition-colors disabled:opacity-40"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="h-10 px-6 rounded-lg text-sm font-semibold text-white bg-[var(--red)] hover:bg-[var(--red-dim)] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {saving ? "Saving Changes..." : "Save Changes"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
