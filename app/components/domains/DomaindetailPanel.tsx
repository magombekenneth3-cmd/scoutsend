"use client";

import { DomainHealth, DnsVerifyResult, SenderDomain, SenderDomainDetail } from "@/app/api/src/lib/domains/domain.type";
import { deleteDomain, fetchDomainById, updateDomain, verifyDomainDns } from "@/app/api/src/lib/domains/domainApi";
import { HEALTH_CONFIG, SEVERITY_CONFIG } from "@/app/api/src/lib/domains/domainConfig";
import { useState, useEffect } from "react";
import { DomainHealthBadge } from "./DomainHealthBadge";
import { DnsRecordRow } from "./DnsRecordRow";


interface DomainDetailPanelProps {
    domain: SenderDomain;
    onClose: () => void;
    onUpdated: (domain: SenderDomain) => void;
    onDeleted: (id: string) => void;
}

function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60_000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

export function DomainDetailPanel({
    domain,
    onClose,
    onUpdated,
    onDeleted,
}: DomainDetailPanelProps) {
    const [detail, setDetail] = useState<SenderDomainDetail | null>(null);
    const [loadingDetail, setLoadingDetail] = useState(true);
    const [editLimit, setEditLimit] = useState(String(domain.dailyLimit));
    const [editHealth, setEditHealth] = useState<DomainHealth>(domain.health);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [verifying, setVerifying] = useState(false);
    const [verifyError, setVerifyError] = useState<string | null>(null);

    useEffect(() => {
        setDetail(null);
        setLoadingDetail(true);
        setEditLimit(String(domain.dailyLimit));
        setEditHealth(domain.health);
        setSaveError(null);
        setConfirmDelete(false);

        fetchDomainById(domain.id)
            .then(setDetail)
            .catch(() => setDetail(null))
            .finally(() => setLoadingDetail(false));
    }, [domain.id, domain.dailyLimit, domain.health]);

    async function handleVerifyDns() {
        setVerifying(true);
        setVerifyError(null);
        try {
            const result: DnsVerifyResult = await verifyDomainDns(domain.id);
            onUpdated({
                ...domain,
                spfValid: result.spfValid,
                dkimValid: result.dkimValid,
                dmarcValid: result.dmarcValid,
                dnsCheckedAt: result.dnsCheckedAt,
            });
        } catch (err) {
            setVerifyError(err instanceof Error ? err.message : "Verification failed");
        } finally {
            setVerifying(false);
        }
    }

    async function handleSave() {
        const limit = Number(editLimit);
        if (isNaN(limit) || limit < 1 || limit > 10000) {
            setSaveError("Daily limit must be between 1 and 10,000");
            return;
        }
        setSaving(true);
        setSaveError(null);
        try {
            const updated = await updateDomain(domain.id, {
                dailyLimit: limit,
                health: editHealth,
            });
            onUpdated(updated as SenderDomain);
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : "Save failed");
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete() {
        setDeleting(true);
        try {
            await deleteDomain(domain.id);
            onDeleted(domain.id);
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : "Delete failed");
            setDeleting(false);
            setConfirmDelete(false);
        }
    }

    const cfg = HEALTH_CONFIG[domain.health];
    const sentPct = domain.dailyLimit > 0
        ? Math.min(Math.round((domain.currentSent / domain.dailyLimit) * 100), 100)
        : 0;

    return (
        <div className="flex flex-col h-full bg-[var(--surface)] border-l border-[var(--border)] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} aria-hidden="true" />
                    <span className="text-sm font-semibold text-[var(--text-primary)] truncate font-mono">
                        {domain.domain}
                    </span>
                </div>
                <button
                    onClick={onClose}
                    aria-label="Close panel"
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                <div className="grid grid-cols-2 gap-3">
                    {[
                        { label: "Health", value: <DomainHealthBadge health={domain.health} size="sm" /> },
                        { label: "Reputation", value: <span className={`text-sm font-semibold ${domain.reputationScore >= 80 ? "text-emerald-400" : domain.reputationScore >= 50 ? "text-amber-400" : "text-red-400"}`}>{Math.round(domain.reputationScore)}/100</span> },
                        { label: "Sent today", value: `${domain.currentSent.toLocaleString()} / ${domain.dailyLimit.toLocaleString()}` },
                        { label: "Total sent", value: domain.totalSent.toLocaleString() },
                        { label: "Bounce rate", value: `${(domain.bounceRate * 100).toFixed(2)}%`, warn: domain.bounceRate > 0.05 },
                        { label: "Complaint rate", value: `${(domain.complaintRate * 100).toFixed(3)}%`, warn: domain.complaintRate > 0.001 },
                    ].map((stat) => (
                        <div key={stat.label} className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg p-3">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">{stat.label}</p>
                            {"value" in stat && typeof stat.value === "string" ? (
                                <p className={`text-sm font-semibold ${stat.warn ? "text-red-400" : "text-[var(--text-primary)]"}`}>{stat.value}</p>
                            ) : (
                                stat.value
                            )}
                        </div>
                    ))}
                </div>

                <div className="space-y-1">
                    <div className="flex justify-between text-xs mb-1">
                        <span className="text-[var(--text-muted)]">Daily limit progress</span>
                        <span className="tabular-nums text-[var(--text-secondary)]">{sentPct}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-[var(--surface-2)] overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all duration-500 ${sentPct >= 90 ? "bg-red-400" : sentPct >= 70 ? "bg-amber-400" : cfg.bar}`}
                            style={{ width: `${sentPct}%` }}
                            role="progressbar"
                            aria-valuenow={sentPct}
                            aria-valuemin={0}
                            aria-valuemax={100}
                        />
                    </div>
                </div>

                <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                            DNS authentication
                        </p>
                        {domain.dnsCheckedAt && (
                            <span className="text-[10px] text-[var(--text-muted)] tabular-nums">
                                checked {timeAgo(domain.dnsCheckedAt)}
                            </span>
                        )}
                    </div>

                    <div className="space-y-2">
                        <DnsRecordRow
                            label="SPF"
                            type="TXT"
                            host={domain.domain}
                            value="v=spf1 include:_spf.scoutsend.com ~all"
                            status={domain.spfValid}
                            helpText="A domain can only have one SPF record. Add the include rather than replacing an existing record — merge the two includes if one already exists."
                        />
                        <DnsRecordRow
                            label="DKIM"
                            type="TXT"
                            host={domain.dkimSelector ? `${domain.dkimSelector}._domainkey.${domain.domain}` : "Generating…"}
                            value={domain.dkimSelector && domain.dkimPublicKey ? `v=DKIM1; k=rsa; p=${domain.dkimPublicKey}` : "Generating…"}
                            status={domain.dkimValid}
                        />
                        <DnsRecordRow
                            label="DMARC"
                            type="TXT"
                            host={`_dmarc.${domain.domain}`}
                            value={`v=DMARC1; p=none; rua=mailto:dmarc@${domain.domain}`}
                            status={domain.dmarcValid}
                            helpText="p=none is monitor-only — it collects reports without rejecting mail. Once SPF and DKIM pass consistently, tighten to p=quarantine or p=reject."
                        />
                    </div>

                    {verifyError && (
                        <p className="text-xs text-[var(--red)]">{verifyError}</p>
                    )}

                    <button
                        onClick={handleVerifyDns}
                        disabled={verifying}
                        className="w-full h-8 rounded-lg text-xs font-semibold text-[var(--text-secondary)] bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--border-red)] hover:text-[var(--text-primary)] disabled:opacity-60 transition-all duration-150 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        {verifying ? (
                            <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                            </svg>
                        ) : null}
                        {verifying ? "Checking DNS…" : "Run DNS check"}
                    </button>
                </div>

                <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg p-4 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Edit settings</p>
                    <div>
                        <label htmlFor="dp-limit" className="block text-xs text-[var(--text-secondary)] mb-1.5">Daily send limit</label>
                        <input
                            id="dp-limit"
                            type="number"
                            min={1}
                            max={10000}
                            value={editLimit}
                            onChange={(e) => setEditLimit(e.target.value)}
                            className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-red)] transition-colors"
                        />
                    </div>
                    <div>
                        <label htmlFor="dp-health" className="block text-xs text-[var(--text-secondary)] mb-1.5">Override health status</label>
                        <select
                            id="dp-health"
                            value={editHealth}
                            onChange={(e) => setEditHealth(e.target.value as DomainHealth)}
                            className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-red)] transition-colors cursor-pointer"
                        >
                            {(["HEALTHY", "WARNING", "DEGRADED", "BLOCKED"] as DomainHealth[]).map((h) => (
                                <option key={h} value={h}>{HEALTH_CONFIG[h].label}</option>
                            ))}
                        </select>
                    </div>
                    {saveError && <p className="text-xs text-[var(--red)]">{saveError}</p>}
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="w-full h-9 rounded-lg text-sm font-semibold text-white bg-[var(--red)] hover:bg-[var(--red-dim)] active:scale-[0.99] disabled:opacity-60 transition-all duration-150 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        {saving ? (
                            <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                        ) : null}
                        {saving ? "Saving…" : "Save changes"}
                    </button>
                </div>

                {!loadingDetail && detail && detail.deliverabilityEvents.length > 0 && (
                    <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                            Recent events
                        </p>
                        <div className="space-y-1.5">
                            {detail.deliverabilityEvents.slice(0, 15).map((ev) => {
                                const sevCfg = SEVERITY_CONFIG[ev.severity] ?? SEVERITY_CONFIG.LOW;
                                return (
                                    <div key={ev.id} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
                                        <span className={`text-[10px] font-bold px-1.5 py-px rounded flex-shrink-0 mt-0.5 ${sevCfg.bg} ${sevCfg.text}`}>
                                            {ev.severity}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs text-[var(--text-primary)] truncate">{ev.type.replace(/_/g, " ")}</p>
                                            {ev.metadata && typeof ev.metadata === "object" && Object.keys(ev.metadata).length > 0 && (
                                                <p className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">
                                                    {Object.entries(ev.metadata).slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                                                </p>
                                            )}
                                        </div>
                                        <span className="text-[11px] text-[var(--text-muted)] tabular-nums flex-shrink-0">
                                            {timeAgo(ev.createdAt)}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {!loadingDetail && detail && detail.campaigns.length > 0 && (
                    <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Campaigns using this domain</p>
                        <div className="space-y-1.5">
                            {detail.campaigns.map((c) => (
                                <div key={c.id} className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
                                    <span className="text-xs text-[var(--text-primary)] truncate">{c.name}</span>
                                    <span className="text-[10px] font-medium text-[var(--text-muted)] flex-shrink-0 ml-2">{c.status}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {loadingDetail && (
                    <div className="space-y-2">
                        {Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="h-10 rounded-lg bg-[var(--surface-2)] animate-pulse" />
                        ))}
                    </div>
                )}
            </div>

            <div className="px-5 py-4 border-t border-[var(--border)] flex-shrink-0">
                {!confirmDelete ? (
                    <button
                        onClick={() => setConfirmDelete(true)}
                        className="w-full h-9 rounded-lg text-sm font-medium text-red-400 bg-red-400/5 border border-red-400/20 hover:bg-red-400/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                    >
                        Delete domain
                    </button>
                ) : (
                    <div className="space-y-2">
                        <p className="text-xs text-[var(--text-muted)] text-center">
                            This will permanently delete <span className="font-mono text-[var(--text-primary)]">{domain.domain}</span>. Cannot be undone.
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setConfirmDelete(false)}
                                className="flex-1 h-9 rounded-lg text-sm font-medium text-[var(--text-secondary)] bg-[var(--surface-2)] border border-[var(--border)] hover:bg-[var(--surface)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDelete}
                                disabled={deleting}
                                className="flex-1 h-9 rounded-lg text-sm font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-60 transition-colors flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                            >
                                {deleting ? (
                                    <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                                ) : null}
                                {deleting ? "Deleting…" : "Confirm delete"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}