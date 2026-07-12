export function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60_000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

export function formatMs(ms: number | null): string {
    if (ms === null) return "—";
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${ms}ms`;
}

export function formatTokens(n: number | null): string {
    if (n === null) return "—";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}

export function confidenceColor(conf: number | null): string {
    if (conf === null) return "text-[var(--text-muted)]";
    if (conf >= 0.75) return "text-emerald-400";
    if (conf >= 0.5) return "text-amber-400";
    return "text-red-400";
}

export function latencyColor(ms: number | null): string {
    if (ms === null) return "text-[var(--text-muted)]";
    if (ms < 2000) return "text-emerald-400";
    if (ms < 5000) return "text-amber-400";
    return "text-red-400";
}

export function agentShortName(name: string): string {
    return name.replace(/Agent$/i, "").replace(/([A-Z])/g, " $1").trim();
}