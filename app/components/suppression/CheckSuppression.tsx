"use client";

import { useState, useRef } from "react";
import type { CheckResult } from "@/app/api/src/lib/suppression/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

const MATCH_LABEL: Record<string, string> = {
    email: "email match",
    domain: "domain match",
    email_domain: "domain of email matched",
};

export function CheckSuppressionWidget() {
    const [query, setQuery] = useState("");
    const [checking, setChecking] = useState(false);
    const [result, setResult] = useState<CheckResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    async function check() {
        const val = query.trim();
        if (!val) return;
        setChecking(true); setResult(null); setError(null);

        const p = new URLSearchParams();
        if (EMAIL_RE.test(val)) p.set("email", val);
        else if (DOMAIN_RE.test(val)) p.set("domain", val);
        else { setError("Enter a valid email or domain."); setChecking(false); return; }

        try {
            const res = await fetch(`/api/suppression/check?${p}`);
            if (!res.ok) throw new Error(`Error ${res.status}`);
            setResult(await res.json());
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setChecking(false);
        }
    }

    function clear() { setQuery(""); setResult(null); setError(null); inputRef.current?.focus(); }

    return (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Check Address</p>

            <div className="flex gap-2">
                <input ref={inputRef} type="text" value={query}
                    onChange={(e) => { setQuery(e.target.value); setResult(null); setError(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") check(); }}
                    placeholder="email@domain.com or domain.com"
                    aria-label="Email or domain to check"
                    className="flex-1 h-9 px-3 rounded-lg bg-[var(--navy-mid)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)]/30 transition-colors font-mono" />
                <button onClick={check} disabled={checking || !query.trim()}
                    className="h-9 px-4 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-red)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] flex items-center gap-2">
                    {checking
                        ? <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeOpacity="0.2" /><path d="M12 2a10 10 0 0 1 10 10" /></svg>
                        : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>}
                    Check
                </button>
            </div>

            {error && <p role="alert" className="text-xs text-red-400">{error}</p>}

            {result && (
                <div className={["rounded-lg px-3 py-2.5 border flex items-start gap-2.5", result.suppressed ? "bg-red-400/5 border-red-400/20" : "bg-emerald-400/5 border-emerald-400/20"].join(" ")}>
                    {result.suppressed
                        ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400 flex-shrink-0 mt-0.5"><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></svg>
                        : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400 flex-shrink-0 mt-0.5"><polyline points="20 6 9 17 4 12" /></svg>}
                    <div className="flex-1 min-w-0 space-y-0.5">
                        <p className={`text-xs font-semibold ${result.suppressed ? "text-red-400" : "text-emerald-400"}`}>
                            {result.suppressed ? "Suppressed" : "Not suppressed"}
                        </p>
                        {result.reason && <p className="text-xs text-[var(--text-muted)] truncate">Reason: {result.reason}</p>}
                        {result.matchedOn && <p className="text-xs text-[var(--text-muted)]">Matched via {MATCH_LABEL[result.matchedOn] ?? result.matchedOn}</p>}
                    </div>
                    <button onClick={clear} aria-label="Clear" className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                </div>
            )}
        </div>
    );
}