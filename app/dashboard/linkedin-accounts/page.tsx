"use client";

import { useState, useEffect, useCallback } from "react";
import { TopBar } from "@/app/components/dashboard/TopBar";

interface LinkedInAccount {
    id: string;
    accountId: string;
    name: string;
    avatarUrl?: string | null;
    profileUrl?: string | null;
    createdAt: string;
    updatedAt: string;
}

function Spinner({ size = 16 }: { size?: number }) {
    return (
        <svg
            width={size} height={size} viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
            className="animate-spin"
        >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
    );
}

function LinkedInIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
            <rect x="2" y="9" width="4" height="12" />
            <circle cx="4" cy="4" r="2" />
        </svg>
    );
}

function AccountCardSkeleton() {
    return (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-[var(--surface-2)] animate-pulse flex-shrink-0" />
            <div className="flex-1 space-y-2">
                <div className="h-3.5 w-36 rounded bg-[var(--surface-2)] animate-pulse" />
                <div className="h-2.5 w-48 rounded bg-[var(--surface-2)] animate-pulse" />
            </div>
            <div className="h-8 w-20 rounded-lg bg-[var(--surface-2)] animate-pulse" />
        </div>
    );
}

function AccountCard({
    account,
    onDelete,
    deleting,
}: {
    account: LinkedInAccount;
    onDelete: (id: string) => void;
    deleting: boolean;
}) {
    return (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 flex items-center gap-4 hover:border-[var(--border-red)]/60 transition-colors">
            <div className="w-10 h-10 rounded-full bg-[var(--red-glow)] border border-[var(--border-red)] flex items-center justify-center text-[var(--red)] flex-shrink-0 overflow-hidden">
                {account.avatarUrl ? (
                    <img src={account.avatarUrl} alt={account.name} className="w-full h-full object-cover rounded-full" />
                ) : (
                    <LinkedInIcon size={18} />
                )}
            </div>

            <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{account.name}</p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-xs font-mono text-[var(--text-muted)] truncate max-w-[180px]">
                        ID: {account.accountId}
                    </span>
                    {account.profileUrl && (
                        <a
                            href={account.profileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-[var(--red)] hover:underline"
                        >
                            View profile →
                        </a>
                    )}
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    Connected {new Date(account.createdAt).toLocaleDateString()}
                </p>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
                <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                    Active
                </span>
                <button
                    onClick={() => onDelete(account.id)}
                    disabled={deleting}
                    className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all disabled:opacity-40"
                    aria-label={`Remove ${account.name}`}
                >
                    {deleting ? <Spinner size={13} /> : (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                        </svg>
                    )}
                </button>
            </div>
        </div>
    );
}

export default function LinkedInAccountsPage() {
    const [accounts, setAccounts] = useState<LinkedInAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [connecting, setConnecting] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
    const [connectError, setConnectError] = useState<string | null>(null);
    const [syncMessage, setSyncMessage] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/linkedin-accounts?limit=100");
            if (!res.ok) throw new Error("Failed to load accounts");
            const data = await res.json();
            setAccounts(data.items ?? []);
        } catch {
            setError("Failed to load LinkedIn accounts.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    async function handleConnect() {
        setConnecting(true);
        setConnectError(null);
        try {
            const res = await fetch("/api/linkedin-accounts/connect-url", { method: "POST" });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error ?? "Failed to get connect URL");
            window.location.href = data.url;
        } catch (err) {
            setConnectError(err instanceof Error ? err.message : "Failed to initiate connection");
            setConnecting(false);
        }
    }

    async function handleSync() {
        setSyncing(true);
        setSyncMessage(null);
        try {
            const res = await fetch("/api/linkedin-accounts/sync", { method: "POST" });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error ?? "Sync failed");
            setSyncMessage(`Synced ${data.synced ?? 0} account${data.synced !== 1 ? "s" : ""}`);
            await load();
        } catch (err) {
            setSyncMessage(err instanceof Error ? err.message : "Sync failed");
        } finally {
            setSyncing(false);
            setTimeout(() => setSyncMessage(null), 4000);
        }
    }

    async function handleDelete(id: string) {
        setDeletingIds(prev => new Set(prev).add(id));
        try {
            const res = await fetch(`/api/linkedin-accounts/${id}`, { method: "DELETE" });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data?.error ?? "Failed to remove account");
            }
            setAccounts(prev => prev.filter(a => a.id !== id));
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to remove account");
        } finally {
            setDeletingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
        }
    }

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <TopBar
                title="LinkedIn Accounts"
                subtitle="Manage connected LinkedIn accounts for outreach campaigns"
            />

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-[var(--red-glow)] border border-[var(--border-red)] flex items-center justify-center text-[var(--red)]">
                            <LinkedInIcon size={20} />
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-[var(--text-primary)]">
                                {accounts.length} account{accounts.length !== 1 ? "s" : ""} connected
                            </p>
                            <p className="text-xs text-[var(--text-muted)]">
                                Powered by Unipile
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2.5">
                        <button
                            onClick={handleSync}
                            disabled={syncing}
                            className="flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-medium text-[var(--text-secondary)] bg-[var(--surface-2)] hover:bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--border-red)]/60 transition-all disabled:opacity-50"
                        >
                            {syncing ? <Spinner size={13} /> : (
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                    <polyline points="23 4 23 10 17 10" />
                                    <polyline points="1 20 1 14 7 14" />
                                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                                </svg>
                            )}
                            Sync from Unipile
                        </button>

                        <button
                            onClick={handleConnect}
                            disabled={connecting}
                            className="flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-semibold text-white bg-[var(--red)] hover:bg-[var(--red-dim)] active:scale-[0.98] transition-all disabled:opacity-50"
                        >
                            {connecting ? <Spinner size={13} /> : (
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                    <line x1="12" y1="5" x2="12" y2="19" />
                                    <line x1="5" y1="12" x2="19" y2="12" />
                                </svg>
                            )}
                            Add LinkedIn account
                        </button>
                    </div>
                </div>

                {syncMessage && (
                    <div className="flex items-center gap-2.5 p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-emerald-400 flex-shrink-0">
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <p className="text-xs text-emerald-400 font-medium">{syncMessage}</p>
                    </div>
                )}

                {connectError && (
                    <div className="flex items-start gap-2.5 p-3.5 bg-[var(--red-glow)] border border-[var(--border-red)] rounded-xl">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-[var(--red)] flex-shrink-0 mt-0.5">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        <p className="text-xs text-[var(--red)]">{connectError}</p>
                    </div>
                )}

                {error && (
                    <div className="flex items-start gap-2.5 p-3.5 bg-[var(--red-glow)] border border-[var(--border-red)] rounded-xl">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-[var(--red)] flex-shrink-0 mt-0.5">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        <p className="text-xs text-[var(--red)]">{error}</p>
                    </div>
                )}

                <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4 space-y-2">
                    <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest">How it works</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {[
                            { step: "1", title: "Connect via Unipile", desc: "Click \"Add LinkedIn account\" to open the Unipile hosted auth flow" },
                            { step: "2", title: "Authorize safely", desc: "Unipile handles the OAuth handshake — your password never touches our servers" },
                            { step: "3", title: "Assign to campaigns", desc: "Select the connected account in the campaign launch wizard" },
                        ].map(({ step, title, desc }) => (
                            <div key={step} className="flex items-start gap-3">
                                <div className="w-6 h-6 rounded-full bg-[var(--red-glow)] border border-[var(--border-red)] flex items-center justify-center text-[9px] font-bold text-[var(--red)] flex-shrink-0 mt-0.5">
                                    {step}
                                </div>
                                <div>
                                    <p className="text-xs font-semibold text-[var(--text-primary)]">{title}</p>
                                    <p className="text-xs text-[var(--text-muted)] leading-relaxed">{desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="space-y-3">
                    {loading ? (
                        <>
                            <AccountCardSkeleton />
                            <AccountCardSkeleton />
                        </>
                    ) : accounts.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                            <div className="w-14 h-14 rounded-2xl bg-[var(--red-glow)] border border-[var(--border-red)] flex items-center justify-center text-[var(--red)]">
                                <LinkedInIcon size={24} />
                            </div>
                            <div>
                                <p className="text-sm font-semibold text-[var(--text-primary)]">No LinkedIn accounts yet</p>
                                <p className="text-xs text-[var(--text-muted)] mt-1 max-w-xs">
                                    Connect a LinkedIn account via Unipile to enable LinkedIn outreach in your campaigns.
                                </p>
                            </div>
                            <button
                                onClick={handleConnect}
                                disabled={connecting}
                                className="flex items-center gap-2 h-9 px-5 rounded-lg text-sm font-semibold text-white bg-[var(--red)] hover:bg-[var(--red-dim)] active:scale-[0.98] transition-all disabled:opacity-50"
                            >
                                {connecting ? <Spinner size={13} /> : null}
                                Add LinkedIn account
                            </button>
                        </div>
                    ) : (
                        accounts.map(account => (
                            <AccountCard
                                key={account.id}
                                account={account}
                                onDelete={handleDelete}
                                deleting={deletingIds.has(account.id)}
                            />
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
