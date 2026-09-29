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
        setSaveError(null);
        setConfirmDelete(false);

        fetchDomainById(domain.id)
            .then(setDetail)
            .catch(() => setDetail(null))
            .finally(() => setLoadingDetail(false));
    }, [domain.id, domain.dailyLimit, domain.health]);

    const [verifyResult, setVerifyResult] = useState<DnsVerifyResult | null>(null);

    async function handleVerifyDns() {
        setVerifying(true);
        setVerifyError(null);
        try {
            const result: DnsVerifyResult = await verifyDomainDns(domain.id);
            setVerifyResult(result);
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

    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape") onClose();
        }
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onClose]);

    const cfg = HEALTH_CONFIG[domain.health];
    const sentPct = domain.dailyLimit > 0
        ? Math.min(Math.round((domain.currentSent / domain.dailyLimit) * 100), 100)
        : 0;

    return (
        <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div 
                className="relative w-full max-w-2xl max-h-[85vh] flex flex-col bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-2)] flex-shrink-0">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${cfg.dot}`} aria-hidden="true" />
                        <span className="text-base font-bold text-[var(--text-primary)] truncate font-mono">
                            {domain.domain}
                        </span>
                        <DomainHealthBadge health={domain.health} size="sm" />
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Close modal"
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
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
                            value="v=spf1 include:<your-mail-provider-spf> ~all"
                            status={domain.spfValid}
                            inconclusive={verifyResult?.inconclusive?.spf}
                            helpText="Ensure your domain's SPF record includes your sending email provider (e.g. include:_spf.google.com for Google Workspace, include:spf.protection.outlook.com for Office365, or your SMTP server's SPF record). A domain must have exactly one valid SPF TXT record."
                        />
                        <DnsRecordRow
                            label="DKIM"
                            type="TXT"
                            host={domain.dkimSelector ? `${domain.dkimSelector}._domainkey.${domain.domain}` : `${domain.domain} (managed by mail provider)`}
                            value={domain.dkimSelector && domain.dkimPublicKey ? `v=DKIM1; k=rsa; p=${domain.dkimPublicKey}` : "Configured in Google Workspace, Office 365, or SMTP provider settings"}
                            status={domain.dkimValid}
                            inconclusive={verifyResult?.inconclusive?.dkim}
                            helpText="DKIM signatures are managed directly by your email provider (Google Workspace, Office 365, or custom SMTP). If using a custom selector, set dkimSelector on your domain."
                        />
                        <DnsRecordRow
                            label="DMARC"
                            type="TXT"
                            host={`_dmarc.${domain.domain}`}
                            value={`v=DMARC1; p=none; rua=mailto:dmarc@${domain.domain}`}
                            status={domain.dmarcValid}
                            inconclusive={verifyResult?.inconclusive?.dmarc}
                            helpText="p=none is monitor-only — it collects reports without rejecting mail. Once SPF and DKIM pass consistently, tighten to p=quarantine or p=reject."
                        />
                    </div>

                    {verifyError && (
                        <p className="text-xs text-[var(--red-text)]">{verifyError}</p>
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

                    {saveError && <p className="text-xs text-[var(--red-text)]">{saveError}</p>}
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
    </div>
    );
}