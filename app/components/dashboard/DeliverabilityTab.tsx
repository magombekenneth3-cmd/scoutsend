"use client";

import { useState, useEffect } from "react";

/* ─── Types ──────────────────────────────────────────────────────────────────── */

interface DeliverabilityEvent {
  id: string;
  type: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  metadata: Record<string, string | number> | null;
  senderDomain: { domain: string; health: string } | null;
  createdAt: string;
}

interface DeliverabilityStats {
  deliveryRate: number;
  openRate: number;
  bounceRate: number;
  complaintCount: number;
  delivered: number;
  opens: number;
  bounces: number;
  emailsSent: number;
}

/* ─── Event type config ──────────────────────────────────────────────────────── */

const EVENT_CFG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
    "email.delivered": {
        label: "Delivered",
        color: "text-emerald-400",
        icon: (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
            </svg>
        ),
    },
    "email.opened": {
        label: "Opened",
        color: "text-sky-400",
        icon: (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
            </svg>
        ),
    },
    "email.bounced": {
        label: "Soft Bounce",
        color: "text-amber-400",
        icon: (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
        ),
    },
    "email.hard_bounce": {
        label: "Hard Bounce",
        color: "text-[var(--red)]",
        icon: (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
        ),
    },
    "email.complained": {
        label: "Spam Complaint",
        color: "text-[var(--red)]",
        icon: (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
        ),
    },
    "domain.health_check": {
        label: "Health Check",
        color: "text-amber-400",
        icon: (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
        ),
    },
};

const SEVERITY_CFG = {
    INFO: { bg: "bg-sky-400/10", text: "text-sky-400", label: "Info" },
    WARNING: { bg: "bg-amber-400/10", text: "text-amber-400", label: "Warning" },
    CRITICAL: { bg: "bg-[var(--red-glow)]", text: "text-[var(--red)]", label: "Critical" },
};

/* ─── Stats summary ──────────────────────────────────────────────────────────── */

function DeliverabilityStatsPanel({ stats }: { stats: DeliverabilityStats }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {[
        {
          label: "Delivery Rate",
          value: stats.emailsSent > 0 ? `${stats.deliveryRate.toFixed(1)}%` : "—",
          color: "text-emerald-400",
          sub: stats.emailsSent > 0 ? `${stats.delivered} delivered` : "No emails sent yet",
        },
        {
          label: "Open Rate",
          value: stats.delivered > 0 ? `${stats.openRate.toFixed(1)}%` : "—",
          color: "text-sky-400",
          sub: stats.delivered > 0 ? `${stats.opens} opens` : "Awaiting delivery",
        },
        {
          label: "Bounce Rate",
          value: stats.emailsSent > 0 ? `${stats.bounceRate.toFixed(1)}%` : "—",
          color: "text-amber-400",
          sub: stats.emailsSent > 0 ? `${stats.bounces} bounces` : "No data yet",
        },
        {
          label: "Complaints",
          value: stats.emailsSent > 0 ? String(stats.complaintCount) : "—",
          color: "text-[var(--red)]",
          sub: stats.complaintCount > 0 ? "Auto-suppressed" : "None recorded",
        },
      ].map((s) => (
        <div key={s.label} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
          <p className="text-xs text-[var(--text-muted)] uppercase tracking-widest font-medium mb-2">{s.label}</p>
          <p className={`text-2xl font-bold font-display tabular-nums leading-none ${s.color}`}>{s.value}</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">{s.sub}</p>
        </div>
      ))}
    </div>
  );
}

/* ─── Component ──────────────────────────────────────────────────────────────── */

interface DeliverabilityTabProps {
  campaignId: string;
}

export function DeliverabilityTab({ campaignId }: DeliverabilityTabProps) {
  const [severityFilter, setSeverityFilter] = useState<"ALL" | "INFO" | "WARNING" | "CRITICAL">("ALL");
  const [events, setEvents] = useState<DeliverabilityEvent[]>([]);
  const [stats, setStats] = useState<DeliverabilityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!campaignId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        const [eventsRes, statsRes] = await Promise.all([
          fetch(`/api/deliverability-events?campaignId=${campaignId}&limit=50`),
          fetch(`/api/deliverability-stats?campaignId=${campaignId}`),
        ]);
        if (!eventsRes.ok) throw new Error(`Events fetch failed (${eventsRes.status})`);
        if (!statsRes.ok)  throw new Error(`Stats fetch failed (${statsRes.status})`);
        const [eventsData, statsData] = await Promise.all([eventsRes.json(), statsRes.json()]);
        if (!cancelled) {
          setEvents(eventsData.data ?? []);
          setStats(statsData);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load deliverability data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [campaignId]);

  const filtered = severityFilter === "ALL"
    ? events
    : events.filter((e) => e.severity === severityFilter);

  return (
    <div className="px-6 py-6 max-w-5xl mx-auto">

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-3">
              <div className="h-2.5 w-20 rounded bg-[var(--surface-2)] animate-pulse" />
              <div className="h-7 w-12 rounded bg-[var(--surface-2)] animate-pulse" />
              <div className="h-2 w-24 rounded bg-[var(--surface-2)] animate-pulse" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 p-3 bg-red-400/5 border border-red-400/20 rounded-xl mb-6">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      ) : stats ? (
        <DeliverabilityStatsPanel stats={stats} />
      ) : null}

      {/* Event log */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <div>
                  <h2 className="text-sm font-semibold font-display text-[var(--text-primary)]">Event Log</h2>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">Webhook-driven delivery tracking</p>
              </div>

              {/* Severity filter */}
              <div className="flex items-center gap-1" role="group" aria-label="Filter by severity">
                  {(["ALL", "INFO", "WARNING", "CRITICAL"] as const).map((s) => {
                      const cfg = s === "ALL" ? null : SEVERITY_CFG[s];
                      return (
                          <button
                              key={s}
                              onClick={() => setSeverityFilter(s)}
                              className={[
                                  "px-2.5 py-1.5 text-xs font-medium rounded-lg transition-all duration-150",
                                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]",
                                  severityFilter === s
                                      ? cfg
                                          ? `${cfg.bg} ${cfg.text} border border-current/20`
                                          : "bg-[var(--red-glow)] text-[var(--red)] border border-[var(--border-red)]"
                                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)]",
                              ].join(" ")}
                              aria-pressed={severityFilter === s}
                          >
                              {s === "ALL" ? "All" : cfg!.label}
                          </button>
                      );
                  })}
              </div>
          </div>

          {/* Events list */}
          <ul role="list" className="divide-y divide-[var(--border)]">
              {filtered.map((event) => {
                  const cfg = EVENT_CFG[event.type];
                  const sevCfg = SEVERITY_CFG[event.severity];
                  return (
                      <li key={event.id} className="flex items-start gap-4 px-5 py-4 hover:bg-[var(--surface-2)] transition-colors duration-100">
                          {/* Event icon */}
                          <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5 ${sevCfg.bg} ${cfg?.color ?? sevCfg.text}`}>
                              {cfg?.icon ?? (
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <circle cx="12" cy="12" r="10" />
                                  </svg>
                              )}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                  <span className={`text-sm font-medium ${cfg?.color ?? "text-[var(--text-secondary)]"}`}>
                                      {cfg?.label ?? event.type}
                                  </span>
                                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${sevCfg.bg} ${sevCfg.text}`}>
                                      {sevCfg.label}
                                  </span>
                                  {event.senderDomain && (
                                      <span className="text-xs text-[var(--text-muted)]">via {event.senderDomain.domain}</span>
                                  )}
                              </div>

                              {/* Metadata chips */}
                              {event.metadata && (
                                  <div className="flex flex-wrap gap-2 mt-1">
                                      {Object.entries(event.metadata).map(([key, val]) => (
                                          <span key={key} className="text-xs bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-secondary)] px-2 py-0.5 rounded font-mono">
                                              {key}: <span className="text-[var(--text-primary)]">{String(val)}</span>
                                          </span>
                                      ))}
                                  </div>
                              )}
                          </div>

                          {/* Timestamp */}
                          <time className="flex-shrink-0 text-xs text-[var(--text-muted)] tabular-nums whitespace-nowrap">
                              {new Date(event.createdAt).toLocaleString(undefined, {
                                  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                              })}
                          </time>
                      </li>
                  );
              })}
          </ul>

          {filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                  <div className="w-12 h-12 rounded-full bg-[var(--surface-2)] flex items-center justify-center text-[var(--text-muted)]">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                          <polyline points="22 4 12 14.01 9 11.01" />
                      </svg>
                  </div>
                  <p className="text-sm font-medium text-[var(--text-secondary)]">No events</p>
                  <p className="text-xs text-[var(--text-muted)]">Events will appear here once emails start sending</p>
              </div>
          )}

          {/* Footer */}
          <div className="px-5 py-3 border-t border-[var(--border)] bg-[var(--navy-mid)]">
              <p className="text-xs text-[var(--text-muted)]">
                  Showing {filtered.length} of {events.length} events · Auto-suppression active for hard bounces and spam complaints
              </p>
          </div>
      </div>

    </div>
  );
}