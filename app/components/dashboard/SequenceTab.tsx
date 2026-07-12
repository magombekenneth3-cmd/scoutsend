"use client";

import { useState, useEffect, useCallback, useRef } from "react";

type Channel = "EMAIL" | "LINKEDIN_VISIT" | "LINKEDIN_CONNECT" | "LINKEDIN_MESSAGE" | "LINKEDIN_INMAIL";
type StepTrigger = "AFTER_DELAY" | "ON_NO_REPLY" | "ON_OPEN" | "ON_CONNECT_ACCEPT" | "ON_NO_ACCEPT";

interface SequenceStep {
    id: string;
    stepIndex: number;
    channel: Channel;
    trigger: StepTrigger;
    delayDays: number;
    messageTemplate: string | null;
    subjectTemplate: string | null;
    createdAt: string;
    updatedAt: string;
}

const CHANNEL_META: Record<Channel, { label: string; icon: React.ReactNode; color: string }> = {
    EMAIL: {
        label: "Email",
        color: "text-sky-400 bg-sky-400/10 border-sky-400/20",
        icon: (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" />
            </svg>
        ),
    },
    LINKEDIN_VISIT: {
        label: "LI Visit",
        color: "text-blue-400 bg-blue-400/10 border-blue-400/20",
        icon: (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
            </svg>
        ),
    },
    LINKEDIN_CONNECT: {
        label: "LI Connect",
        color: "text-violet-400 bg-violet-400/10 border-violet-400/20",
        icon: (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="23" y1="11" x2="17" y2="11" /><line x1="20" y1="8" x2="20" y2="14" />
            </svg>
        ),
    },
    LINKEDIN_MESSAGE: {
        label: "LI Message",
        color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
        icon: (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
        ),
    },
    LINKEDIN_INMAIL: {
        label: "LI InMail",
        color: "text-amber-400 bg-amber-400/10 border-amber-400/20",
        icon: (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><path d="M22 6l-10 7L2 6" />
            </svg>
        ),
    },
};

const TRIGGER_LABELS: Record<StepTrigger, string> = {
    AFTER_DELAY: "After delay",
    ON_NO_REPLY: "On no reply",
    ON_OPEN: "On open",
    ON_CONNECT_ACCEPT: "On connect accept",
    ON_NO_ACCEPT: "On no accept",
};

const CHANNELS = Object.keys(CHANNEL_META) as Channel[];
const TRIGGERS = Object.keys(TRIGGER_LABELS) as StepTrigger[];

function Spinner() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
    );
}

interface StepCardProps {
    step: SequenceStep;
    index: number;
    total: number;
    dragging: boolean;
    onDragStart: (id: string) => void;
    onDragOver: (e: React.DragEvent, id: string) => void;
    onDrop: () => void;
    onChange: (id: string, patch: Partial<Pick<SequenceStep, "channel" | "trigger" | "delayDays" | "messageTemplate" | "subjectTemplate">>) => void;
    onDelete: (id: string) => void;
    saving: boolean;
    deleting: boolean;
}

function StepCard({ step, index, dragging, onDragStart, onDragOver, onDrop, onChange, onDelete, saving, deleting }: StepCardProps) {
    const channelMeta = CHANNEL_META[step.channel];
    const needsSubject = step.channel === "EMAIL" || step.channel === "LINKEDIN_INMAIL";
    const [deleteConfirm, setDeleteConfirm] = useState(false);

    return (
        <div
            draggable
            onDragStart={() => onDragStart(step.id)}
            onDragOver={(e) => { e.preventDefault(); onDragOver(e, step.id); }}
            onDrop={onDrop}
            className={[
                "bg-[var(--surface)] border rounded-xl transition-all duration-150",
                dragging ? "opacity-40 scale-[0.98]" : "opacity-100",
                "border-[var(--border)] hover:border-[rgba(255,255,255,0.12)]",
            ].join(" ")}
        >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)]">
                <div
                    className="cursor-grab active:cursor-grabbing text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors flex-shrink-0"
                    aria-label="Drag to reorder"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
                        <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
                        <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
                    </svg>
                </div>

                <span className="w-6 h-6 rounded-full bg-[var(--surface-2)] border border-[var(--border)] text-xs font-bold text-[var(--text-secondary)] flex items-center justify-center flex-shrink-0">
                    {index + 1}
                </span>

                <div className="flex flex-wrap gap-1.5 flex-1">
                    {CHANNELS.map((ch) => {
                        const m = CHANNEL_META[ch];
                        const active = step.channel === ch;
                        return (
                            <button
                                key={ch}
                                onClick={() => onChange(step.id, { channel: ch })}
                                disabled={saving}
                                aria-pressed={active}
                                className={[
                                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-all duration-150",
                                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] disabled:opacity-50",
                                    active ? m.color : "text-[var(--text-muted)] border-[var(--border)] hover:border-[rgba(255,255,255,0.15)] hover:text-[var(--text-secondary)]",
                                ].join(" ")}
                            >
                                {m.icon}{m.label}
                            </button>
                        );
                    })}
                </div>

                {saving ? (
                    <span className="text-[var(--text-muted)] flex-shrink-0"><Spinner /></span>
                ) : deleteConfirm ? (
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-xs text-[var(--text-muted)]">Delete?</span>
                        <button onClick={() => { onDelete(step.id); setDeleteConfirm(false); }} disabled={deleting} className="text-xs font-medium text-red-400 hover:underline focus-visible:outline-none disabled:opacity-50">Yes</button>
                        <button onClick={() => setDeleteConfirm(false)} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] focus-visible:outline-none">No</button>
                    </div>
                ) : (
                    <button
                        onClick={() => setDeleteConfirm(true)}
                        aria-label="Delete step"
                        className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-red-400 hover:bg-red-400/10 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                    >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" />
                        </svg>
                    </button>
                )}
            </div>

            <div className="grid grid-cols-2 gap-4 px-4 py-3">
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-widest">Trigger</label>
                    <select
                        value={step.trigger}
                        onChange={(e) => onChange(step.id, { trigger: e.target.value as StepTrigger })}
                        disabled={saving}
                        className="w-full text-sm bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)] transition-colors disabled:opacity-50 appearance-none cursor-pointer"
                    >
                        {TRIGGERS.map((t) => (
                            <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>
                        ))}
                    </select>
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-widest">Delay (days)</label>
                    <input
                        type="number"
                        min={0}
                        max={60}
                        value={step.delayDays}
                        onChange={(e) => onChange(step.id, { delayDays: Math.max(0, Math.min(60, parseInt(e.target.value) || 0)) })}
                        disabled={saving}
                        className="w-full text-sm bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)] transition-colors disabled:opacity-50 tabular-nums"
                    />
                </div>
            </div>

            {needsSubject && (
                <div className="px-4 pb-3">
                    <label className="block text-xs text-[var(--text-muted)] font-medium uppercase tracking-widest mb-1">Subject template</label>
                    <input
                        type="text"
                        placeholder="e.g. {{firstName}}, quick question about {{companyName}}"
                        value={step.subjectTemplate ?? ""}
                        onChange={(e) => onChange(step.id, { subjectTemplate: e.target.value || null })}
                        disabled={saving}
                        className="w-full text-sm bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)] transition-colors disabled:opacity-50"
                    />
                </div>
            )}

            <div className="px-4 pb-4">
                <label className="block text-xs text-[var(--text-muted)] font-medium uppercase tracking-widest mb-1">Message template</label>
                <textarea
                    rows={3}
                    placeholder="Optional override — leave blank to let AI generate per lead"
                    value={step.messageTemplate ?? ""}
                    onChange={(e) => onChange(step.id, { messageTemplate: e.target.value || null })}
                    disabled={saving}
                    className="w-full text-sm bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)] transition-colors disabled:opacity-50 resize-none leading-relaxed"
                />
            </div>
        </div>
    );
}

interface SequenceTabProps {
    campaignId: string;
}

export function SequenceTab({ campaignId }: SequenceTabProps) {
    const [steps, setSteps] = useState<SequenceStep[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const dragId = useRef<string | null>(null);
    const overId = useRef<string | null>(null);
    const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    const fetchSteps = useCallback(async () => {
        try {
            const res = await fetch(`/api/campaigns/${campaignId}/sequence-steps`, { cache: "no-store" });
            if (!res.ok) throw new Error(`Server error ${res.status}`);
            setSteps(await res.json());
            setError(null);
        } catch {
            setError("Failed to load sequence steps.");
        } finally {
            setLoading(false);
        }
    }, [campaignId]);

    useEffect(() => { fetchSteps(); }, [fetchSteps]);

    async function handleAdd() {
        if (adding || steps.length >= 10) return;
        setAdding(true);
        try {
            const res = await fetch(`/api/campaigns/${campaignId}/sequence-steps`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ channel: "EMAIL", trigger: "AFTER_DELAY", delayDays: 3 }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.error ?? `Request failed (${res.status})`);
            }
            const step: SequenceStep = await res.json();
            setSteps((prev) => [...prev, step]);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to add step.");
        } finally {
            setAdding(false);
        }
    }

    function handleChange(id: string, patch: Partial<Pick<SequenceStep, "channel" | "trigger" | "delayDays" | "messageTemplate" | "subjectTemplate">>) {
        setSteps((prev) => prev.map((s) => s.id === id ? { ...s, ...patch } : s));

        if (saveTimers.current.has(id)) clearTimeout(saveTimers.current.get(id));
        const timer = setTimeout(async () => {
            setSavingId(id);
            try {
                await fetch(`/api/campaigns/${campaignId}/sequence-steps/${id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(patch),
                });
            } finally {
                setSavingId(null);
                saveTimers.current.delete(id);
            }
        }, 800);
        saveTimers.current.set(id, timer);
    }

    async function handleDelete(id: string) {
        setDeletingId(id);
        try {
            const res = await fetch(`/api/campaigns/${campaignId}/sequence-steps/${id}`, { method: "DELETE" });
            if (!res.ok && res.status !== 204) throw new Error(`Request failed (${res.status})`);
            setSteps((prev) => prev.filter((s) => s.id !== id).map((s, i) => ({ ...s, stepIndex: i })));
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to delete step.");
        } finally {
            setDeletingId(null);
        }
    }

    async function handleDrop() {
        if (!dragId.current || !overId.current || dragId.current === overId.current) return;

        const fromIdx = steps.findIndex((s) => s.id === dragId.current);
        const toIdx = steps.findIndex((s) => s.id === overId.current);
        if (fromIdx === -1 || toIdx === -1) return;

        const reordered = [...steps];
        const [moved] = reordered.splice(fromIdx, 1);
        reordered.splice(toIdx, 0, moved);
        const updated = reordered.map((s, i) => ({ ...s, stepIndex: i }));
        setSteps(updated);

        await Promise.all(
            updated.map((s) =>
                fetch(`/api/campaigns/${campaignId}/sequence-steps/${s.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ stepIndex: s.stepIndex }),
                })
            )
        );

        dragId.current = null;
        overId.current = null;
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <svg className="animate-spin text-[var(--red)]" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
            </div>
        );
    }

    return (
        <div className="max-w-2xl mx-auto px-6 py-6 space-y-4">
            <div className="flex items-center justify-between mb-2">
                <div>
                    <h2 className="text-sm font-semibold font-display text-[var(--text-primary)]">Outreach Sequence</h2>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">Steps execute in order. Drag to reorder. Changes auto-save.</p>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--text-muted)]">{steps.length}/10 steps</span>
                    <button
                        onClick={handleAdd}
                        disabled={adding || steps.length >= 10}
                        className="inline-flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] active:scale-[0.97] transition-all duration-150 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        {adding ? <Spinner /> : (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                        )}
                        Add Step
                    </button>
                </div>
            </div>

            {error && (
                <div role="alert" className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-400/5 border border-red-400/20 text-xs text-red-400">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                    {error}
                    <button onClick={() => setError(null)} className="ml-auto hover:underline focus-visible:outline-none">Dismiss</button>
                </div>
            )}

            {steps.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-4 border border-dashed border-[var(--border)] rounded-xl text-center">
                    <div className="w-12 h-12 rounded-full bg-[var(--surface-2)] flex items-center justify-center text-[var(--text-muted)]">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
                    </div>
                    <div>
                        <p className="text-sm font-medium text-[var(--text-secondary)]">No sequence steps</p>
                        <p className="text-xs text-[var(--text-muted)] mt-1">Add a step to define your outreach flow. The AI will use these as the blueprint for each lead.</p>
                    </div>
                    <button
                        onClick={handleAdd}
                        disabled={adding}
                        className="inline-flex items-center gap-2 text-xs font-medium px-4 py-2.5 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] active:scale-[0.97] transition-all duration-150 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        {adding ? <Spinner /> : "Add first step"}
                    </button>
                </div>
            ) : (
                <div className="space-y-3">
                    {steps.map((step, i) => (
                        <StepCard
                            key={step.id}
                            step={step}
                            index={i}
                            total={steps.length}
                            dragging={dragId.current === step.id}
                            onDragStart={(id) => { dragId.current = id; }}
                            onDragOver={(_, id) => { overId.current = id; }}
                            onDrop={handleDrop}
                            onChange={handleChange}
                            onDelete={handleDelete}
                            saving={savingId === step.id}
                            deleting={deletingId === step.id}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
