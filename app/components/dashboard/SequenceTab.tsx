"use client";

import { useState, useEffect, useCallback, useRef, Fragment } from "react";

type Channel =
    | "EMAIL"
    | "LINKEDIN_VISIT"
    | "LINKEDIN_CONNECT"
    | "LINKEDIN_MESSAGE"
    | "LINKEDIN_INMAIL";

type StepTrigger =
    | "AFTER_DELAY"
    | "ON_NO_REPLY"
    | "ON_OPEN"
    | "ON_CONNECT_ACCEPT"
    | "ON_NO_ACCEPT";

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

const CHANNEL_META: Record<
    Channel,
    { label: string; icon: React.ReactNode; color: string; glow: string }
> = {
    EMAIL: {
        label: "Email",
        color: "text-sky-400 bg-sky-400/10 border-sky-400/30",
        glow: "hover:border-sky-400/40 hover:shadow-[0_0_28px_rgba(56,189,248,0.1)]",
        icon: (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <polyline points="3 7 12 13 21 7" />
            </svg>
        ),
    },
    LINKEDIN_VISIT: {
        label: "LI Visit",
        color: "text-blue-400 bg-blue-400/10 border-blue-400/30",
        glow: "hover:border-blue-400/40 hover:shadow-[0_0_28px_rgba(96,165,250,0.1)]",
        icon: (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z" />
            </svg>
        ),
    },
    LINKEDIN_CONNECT: {
        label: "LI Connect",
        color: "text-violet-400 bg-violet-400/10 border-violet-400/30",
        glow: "hover:border-violet-400/40 hover:shadow-[0_0_28px_rgba(167,139,250,0.1)]",
        icon: (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="9" cy="8" r="3" />
                <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
                <path d="M17 8v6M14 11h6" />
            </svg>
        ),
    },
    LINKEDIN_MESSAGE: {
        label: "LI Message",
        color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
        glow: "hover:border-emerald-400/40 hover:shadow-[0_0_28px_rgba(52,211,153,0.1)]",
        icon: (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 11.5a8.4 8.4 0 0 1-9 8.3 9.5 9.5 0 0 1-4.1-.9L3 20l1.4-4.1a8.2 8.2 0 0 1-.9-3.9 8.5 8.5 0 0 1 8.5-8.5 8.4 8.4 0 0 1 9 8Z" />
            </svg>
        ),
    },
    LINKEDIN_INMAIL: {
        label: "LI InMail",
        color: "text-amber-400 bg-amber-400/10 border-amber-400/30",
        glow: "hover:border-amber-400/40 hover:shadow-[0_0_28px_rgba(251,191,36,0.1)]",
        icon: (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <polyline points="3 7 12 13 21 7" />
                <path d="M16 10v5M16 8h.01" />
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

const TRIGGER_META: Record<
    StepTrigger,
    { shortLabel: string; badgeClass: string; dotClass: string }
> = {
    AFTER_DELAY: {
        shortLabel: "Delay",
        badgeClass: "text-[var(--text-muted)] border-[var(--border)] bg-transparent",
        dotClass: "bg-[var(--text-muted)]",
    },
    ON_NO_REPLY: {
        shortLabel: "No Reply",
        badgeClass: "text-amber-400 border-amber-400/30 bg-amber-400/5",
        dotClass: "bg-amber-400",
    },
    ON_OPEN: {
        shortLabel: "If Opened",
        badgeClass: "text-emerald-400 border-emerald-400/30 bg-emerald-400/5",
        dotClass: "bg-emerald-400",
    },
    ON_CONNECT_ACCEPT: {
        shortLabel: "If Connected",
        badgeClass: "text-violet-400 border-violet-400/30 bg-violet-400/5",
        dotClass: "bg-violet-400",
    },
    ON_NO_ACCEPT: {
        shortLabel: "Not Accepted",
        badgeClass: "text-red-400 border-red-400/30 bg-red-400/5",
        dotClass: "bg-red-400",
    },
};

const CHANNELS = Object.keys(CHANNEL_META) as Channel[];
const TRIGGERS = Object.keys(TRIGGER_LABELS) as StepTrigger[];

function Spinner() {
    return (
        <svg
            className="animate-spin"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
        >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
    );
}

function EntryNode() {
    return (
        <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-[var(--border)] bg-[var(--surface)] shadow-md">
            <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-sky-400"
                aria-hidden="true"
            >
                <path d="M5 12h14" />
                <path d="m13 6 6 6-6 6" />
            </svg>
            <span className="text-[10px] font-semibold text-[var(--text-secondary)]">
                Lead Enters Sequence
            </span>
        </div>
    );
}

interface DelayConnectorProps {
    step: SequenceStep;
    onChange: (
        id: string,
        patch: Partial<Pick<SequenceStep, "delayDays">>
    ) => void;
    saving: boolean;
}

function DelayConnector({
    step,
    onChange,
    saving,
}: DelayConnectorProps) {
    const tm = TRIGGER_META[step.trigger];
    const isConditional = step.trigger !== "AFTER_DELAY";

    return (
        <div
            className="flex flex-col items-center"
            aria-label={`Connector: ${TRIGGER_LABELS[step.trigger]}, ${step.delayDays} day delay`}
        >
            <div className="w-px h-5 bg-[var(--border)]" />

            {isConditional && (
                <>
                    <div
                        className={`flex items - center gap - 1.5 px - 2.5 py - 1 rounded - full border text - [10px] font - semibold tracking - wide ${tm.badgeClass} `}
                    >
                        <span
                            className={`w - 1.5 h - 1.5 rounded - full flex - shrink - 0 ${tm.dotClass} `}
                            aria-hidden="true"
                        />
                        {tm.shortLabel}
                    </div>
                    <div className="w-px h-3 bg-[var(--border)]" />
                </>
            )}

            <div className="group flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--red)]/50 transition-all duration-150 shadow-sm cursor-default">
                <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-[var(--text-muted)] flex-shrink-0"
                    aria-hidden="true"
                >
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                </svg>

                <span className="text-[10px] font-mono text-[var(--text-secondary)] tabular-nums select-none">
                    {step.delayDays === 0
                        ? "Immediately"
                        : step.delayDays === 1
                            ? "1 day"
                            : `${step.delayDays} days`}
                </span>

                <div className="hidden group-hover:flex items-center gap-0.5 pl-1.5 ml-0.5 border-l border-[var(--border)]">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onChange(step.id, {
                                delayDays: Math.max(0, step.delayDays - 1),
                            });
                        }}
                        disabled={saving || step.delayDays <= 0}
                        aria-label="Decrease delay by 1 day"
                        className="w-4 h-4 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-white hover:bg-[var(--surface-3)] disabled:opacity-30 text-xs leading-none transition-colors focus-visible:outline-none"
                    >
                        −
                    </button>

                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onChange(step.id, {
                                delayDays: Math.min(60, step.delayDays + 1),
                            });
                        }}
                        disabled={saving || step.delayDays >= 60}
                        aria-label="Increase delay by 1 day"
                        className="w-4 h-4 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-white hover:bg-[var(--surface-3)] disabled:opacity-30 text-xs leading-none transition-colors focus-visible:outline-none"
                    >
                        +
                    </button>
                </div>
            </div>

            <div
                className="w-px h-4"
                style={{
                    background:
                        "linear-gradient(to bottom, var(--border), var(--border-red))",
                }}
            />

            <svg
                width="8"
                height="5"
                viewBox="0 0 8 5"
                aria-hidden="true"
                className="-mt-px"
                style={{ color: "var(--border-red)" }}
            >
                <path d="M0 0L4 5L8 0" fill="currentColor" />
            </svg>
        </div>
    );
}

type ChangePatch = Partial<
    Pick<
        SequenceStep,
        | "channel"
        | "trigger"
        | "delayDays"
        | "messageTemplate"
        | "subjectTemplate"
    >
>;

interface StepNodeProps {
    step: SequenceStep;
    index: number;
    isExpanded: boolean;
    onToggleExpand: () => void;
    onChange: (id: string, patch: ChangePatch) => void;
    onDelete: (id: string) => void;
    saving: boolean;
    deleting: boolean;
    onDragStart: (id: string) => void;
    onDragOver: (e: React.DragEvent, id: string) => void;
    onDrop: () => void;
    isDragging: boolean;
}

function StepNode({
    step,
    index,
    isExpanded,
    onToggleExpand,
    onChange,
    onDelete,
    saving,
    deleting,
    onDragStart,
    onDragOver,
    onDrop,
    isDragging,
}: StepNodeProps) {
    const meta = CHANNEL_META[step.channel];
    const [deleteConfirm, setDeleteConfirm] = useState(false);
    const needsSubject =
        step.channel === "EMAIL" || step.channel === "LINKEDIN_INMAIL";
    const hasContent = !!(step.messageTemplate || step.subjectTemplate);

    return (
        <div
            draggable={!saving && !deleting}
            onDragStart={() => onDragStart(step.id)}
            onDragOver={(e) => {
                e.preventDefault();
                onDragOver(e, step.id);
            }}
            onDrop={onDrop}
            className={`w - 72 transition - all duration - 200 ${isDragging ? "opacity-40 scale-[0.97]" : "opacity-100"
                } `}
        >
            <div
                className={[
                    "relative rounded-xl border bg-[var(--surface)]/90 backdrop-blur-sm shadow-lg transition-all duration-200",
                    meta.glow,
                    "border-[var(--border)]",
                ].join(" ")}
            >
                <div className="flex items-center gap-2 px-3 py-3 border-b border-[var(--border)]">
                    <div
                        className="cursor-grab active:cursor-grabbing text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors flex-shrink-0"
                        aria-label="Drag to reorder"
                    >
                        <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            aria-hidden="true"
                        >
                            <circle cx="9" cy="6" r="1.5" />
                            <circle cx="15" cy="6" r="1.5" />
                            <circle cx="9" cy="12" r="1.5" />
                            <circle cx="15" cy="12" r="1.5" />
                            <circle cx="9" cy="18" r="1.5" />
                            <circle cx="15" cy="18" r="1.5" />
                        </svg>
                    </div>

                    <span
                        className={`w - 5 h - 5 rounded - full flex items - center justify - center text - [9px] font - bold border flex - shrink - 0 ${meta.color} `}
                    >
                        {index + 1}
                    </span>

                    <span
                        className={`${meta.color.split(" ")[0]} flex - shrink - 0`}
                    >
                        {meta.icon}
                    </span>

                    <span className="text-sm font-semibold text-[var(--text-primary)] flex-1 truncate">
                        {meta.label}
                    </span>

                    {saving && (
                        <span className="text-[var(--text-muted)] flex-shrink-0">
                            <Spinner />
                        </span>
                    )}

                    {hasContent && !saving && (
                        <span
                            className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0"
                            title="Template content set"
                            aria-label="Has template content"
                        />
                    )}

                    <button
                        onClick={onToggleExpand}
                        aria-expanded={isExpanded}
                        aria-label={
                            isExpanded
                                ? "Collapse step editor"
                                : "Expand step editor"
                        }
                        className="w-6 h-6 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--red)]"
                    >
                        <svg
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className={`transition - transform duration - 200 ${isExpanded ? "rotate-180" : ""
                                } `}
                            aria-hidden="true"
                        >
                            <polyline points="6 9 12 15 18 9" />
                        </svg>
                    </button>
                </div>

                <div className="flex flex-wrap gap-1 px-3 py-2.5">
                    {CHANNELS.map((ch) => {
                        const m = CHANNEL_META[ch];
                        const active = step.channel === ch;

                        return (
                            <button
                                key={ch}
                                onClick={() =>
                                    onChange(step.id, {
                                        channel: ch,
                                        ...(ch !== "EMAIL" &&
                                            ch !== "LINKEDIN_INMAIL"
                                            ? { subjectTemplate: null }
                                            : {}),
                                    })
                                }
                                disabled={saving || deleting}
                                aria-pressed={active}
                                className={[
                                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium transition-all duration-150",
                                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--red)] disabled:opacity-50",
                                    active
                                        ? m.color
                                        : "text-[var(--text-muted)] border-transparent hover:border-[var(--border)] hover:text-[var(--text-secondary)]",
                                ].join(" ")}
                            >
                                {m.icon}
                                {m.label}
                            </button>
                        );
                    })}
                </div>

                {!isExpanded && step.subjectTemplate && (
                    <div className="px-3 pb-2.5 -mt-1">
                        <p
                            className="text-[10px] text-[var(--text-muted)] truncate italic"
                            title={step.subjectTemplate}
                        >
                            &ldquo;{step.subjectTemplate}&rdquo;
                        </p>
                    </div>
                )}
            </div>

            {isExpanded && (
                <div className="mt-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-inner overflow-hidden">
                    <div className="px-4 pt-3 pb-2.5 border-b border-[var(--border)] flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest">
                            Step Settings
                        </span>

                        {deleteConfirm ? (
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-[var(--text-muted)]">
                                    Delete?
                                </span>

                                <button
                                    onClick={() => {
                                        onDelete(step.id);
                                        setDeleteConfirm(false);
                                    }}
                                    disabled={deleting}
                                    className="text-[10px] font-semibold text-red-400 hover:underline focus-visible:outline-none disabled:opacity-50"
                                >
                                    {deleting ? <Spinner /> : "Yes"}
                                </button>

                                <button
                                    onClick={() => setDeleteConfirm(false)}
                                    disabled={deleting}
                                    className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] focus-visible:outline-none disabled:opacity-50"
                                >
                                    No
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => setDeleteConfirm(true)}
                                disabled={saving || deleting}
                                aria-label="Delete step"
                                className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-red-400 transition-colors focus-visible:outline-none disabled:opacity-50"
                            >
                                <svg
                                    width="11"
                                    height="11"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden="true"
                                >
                                    <polyline points="3 6 5 6 21 6" />
                                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                    <path d="M10 11v6" />
                                    <path d="M14 11v6" />
                                </svg>
                                Delete
                            </button>
                        )}
                    </div>

                    <div className="p-4 space-y-3">
                        <div>
                            <label className="block text-[10px] font-medium uppercase tracking-widest text-[var(--text-muted)] mb-1.5">
                                Trigger
                            </label>

                            <select
                                value={step.trigger}
                                onChange={(e) =>
                                    onChange(step.id, {
                                        trigger: e.target.value as StepTrigger,
                                    })
                                }
                                disabled={saving || deleting}
                                className="w-full text-xs bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)] transition-colors disabled:opacity-50 appearance-none cursor-pointer"
                            >
                                {TRIGGERS.map((t) => (
                                    <option key={t} value={t}>
                                        {TRIGGER_LABELS[t]}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-[10px] font-medium uppercase tracking-widest text-[var(--text-muted)] mb-1.5">
                                Delay (days)
                            </label>

                            <input
                                type="number"
                                min={0}
                                max={60}
                                value={step.delayDays}
                                onChange={(e) =>
                                    onChange(step.id, {
                                        delayDays: Math.max(
                                            0,
                                            Math.min(
                                                60,
                                                parseInt(e.target.value, 10) || 0
                                            )
                                        ),
                                    })
                                }
                                disabled={saving || deleting}
                                className="w-full text-xs bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)] transition-colors disabled:opacity-50 tabular-nums"
                            />
                        </div>

                        {needsSubject && (
                            <div>
                                <label className="block text-[10px] font-medium uppercase tracking-widest text-[var(--text-muted)] mb-1.5">
                                    Subject template
                                </label>

                                <input
                                    type="text"
                                    placeholder="e.g. {{firstName}}, quick question about {{companyName}}"
                                    value={step.subjectTemplate ?? ""}
                                    onChange={(e) =>
                                        onChange(step.id, {
                                            subjectTemplate:
                                                e.target.value || null,
                                        })
                                    }
                                    disabled={saving || deleting}
                                    className="w-full text-xs bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)] transition-colors disabled:opacity-50"
                                />
                            </div>
                        )}

                        <div>
                            <label className="block text-[10px] font-medium uppercase tracking-widest text-[var(--text-muted)] mb-1.5">
                                Message template
                            </label>

                            <textarea
                                rows={3}
                                placeholder="Optional override — leave blank to let AI generate per lead"
                                value={step.messageTemplate ?? ""}
                                onChange={(e) =>
                                    onChange(step.id, {
                                        messageTemplate:
                                            e.target.value || null,
                                    })
                                }
                                disabled={saving || deleting}
                                className="w-full text-xs bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)] transition-colors disabled:opacity-50 resize-none leading-relaxed"
                            />
                        </div>
                    </div>
                </div>
            )}
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
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [draggingId, setDraggingId] = useState<string | null>(null);

    const dragId = useRef<string | null>(null);
    const overId = useRef<string | null>(null);
    const saveTimers = useRef<
        Map<string, ReturnType<typeof setTimeout>>
    >(new Map());

    const fetchSteps = useCallback(async () => {
        if (!campaignId) {
            setSteps([]);
            setLoading(false);
            return;
        }

        setLoading(true);

        try {
            const res = await fetch(
                `/ api / campaigns / ${encodeURIComponent(
                    campaignId
                )
                }/sequence-steps`,
                { cache: "no-store" }
            );

            if (!res.ok) {
                throw new Error(`Server error ${res.status}`);
            }

            const data = await res.json();

            if (!Array.isArray(data)) {
                throw new Error("Invalid sequence response");
            }

            const normalized = [...data].sort(
                (a: SequenceStep, b: SequenceStep) =>
                    a.stepIndex - b.stepIndex
            );

            setSteps(normalized);
            setError(null);
        } catch {
            setError("Failed to load sequence steps.");
        } finally {
            setLoading(false);
        }
    }, [campaignId]);

    useEffect(() => {
        fetchSteps();

        return () => {
            for (const timer of saveTimers.current.values()) {
                clearTimeout(timer);
            }
            saveTimers.current.clear();
        };
    }, [fetchSteps]);

    const handleAdd = useCallback(async () => {
        if (adding || steps.length >= 10) return;

        setAdding(true);
        setError(null);

        try {
            const res = await fetch(
                `/api/campaigns/${encodeURIComponent(
                    campaignId
                )}/sequence-steps`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        channel: "EMAIL",
                        trigger: "AFTER_DELAY",
                        delayDays: 3,
                    }),
                }
            );

            const body = await res.json().catch(() => null);

            if (!res.ok) {
                throw new Error(
                    body?.error ?? `Request failed (${res.status})`
                );
            }

            const step: SequenceStep = body;

            setSteps((prev) =>
                [...prev, step].sort(
                    (a, b) => a.stepIndex - b.stepIndex
                )
            );

            setExpandedId(step.id);
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Failed to add step."
            );
        } finally {
            setAdding(false);
        }
    }, [adding, campaignId, steps.length]);

    const handleChange = useCallback(
        (id: string, patch: ChangePatch) => {
            if (deletingId === id) return;

            setSteps((prev) =>
                prev.map((s) =>
                    s.id === id ? { ...s, ...patch } : s
                )
            );

            const existingTimer = saveTimers.current.get(id);

            if (existingTimer) {
                clearTimeout(existingTimer);
            }

            const timer = setTimeout(async () => {
                if (deletingId === id) {
                    saveTimers.current.delete(id);
                    return;
                }

                setSavingId(id);
                setError(null);

                try {
                    const res = await fetch(
                        `/api/campaigns/${encodeURIComponent(
                            campaignId
                        )}/sequence-steps/${encodeURIComponent(id)}`,
                        {
                            method: "PATCH",
                            headers: {
                                "Content-Type": "application/json",
                            },
                            body: JSON.stringify(patch),
                        }
                    );

                    if (!res.ok) {
                        throw new Error(
                            `Failed to save step (${res.status})`
                        );
                    }
                } catch (err) {
                    setError(
                        err instanceof Error
                            ? err.message
                            : "Failed to save sequence step."
                    );
                    await fetchSteps();
                } finally {
                    setSavingId((current) =>
                        current === id ? null : current
                    );
                    saveTimers.current.delete(id);
                }
            }, 800);

            saveTimers.current.set(id, timer);
        },
        [campaignId, deletingId, fetchSteps]
    );

    const handleDelete = useCallback(
        async (id: string) => {
            if (deletingId) return;

            const timer = saveTimers.current.get(id);

            if (timer) {
                clearTimeout(timer);
                saveTimers.current.delete(id);
            }

            setDeletingId(id);
            setError(null);

            try {
                const res = await fetch(
                    `/api/campaigns/${encodeURIComponent(
                        campaignId
                    )}/sequence-steps/${encodeURIComponent(id)}`,
                    { method: "DELETE" }
                );

                if (!res.ok && res.status !== 204) {
                    const body = await res.json().catch(() => null);
                    throw new Error(
                        body?.error ?? `Request failed (${res.status})`
                    );
                }

                const remaining = steps
                    .filter((s) => s.id !== id)
                    .map((s, i) => ({
                        ...s,
                        stepIndex: i,
                    }));

                setSteps(remaining);

                if (expandedId === id) {
                    setExpandedId(null);
                }

                setSavingId((current) =>
                    current === id ? null : current
                );

                await fetchSteps();
            } catch (err) {
                setError(
                    err instanceof Error
                        ? err.message
                        : "Failed to delete step."
                );
                await fetchSteps();
            } finally {
                setDeletingId(null);
            }
        },
        [
            campaignId,
            deletingId,
            expandedId,
            fetchSteps,
            steps,
        ]
    );

    const handleDrop = useCallback(async () => {
        const currentDragId = dragId.current;
        const currentOverId = overId.current;

        setDraggingId(null);

        if (
            !currentDragId ||
            !currentOverId ||
            currentDragId === currentOverId
        ) {
            dragId.current = null;
            overId.current = null;
            return;
        }

        const fromIdx = steps.findIndex(
            (s) => s.id === currentDragId
        );
        const toIdx = steps.findIndex(
            (s) => s.id === currentOverId
        );

        if (fromIdx === -1 || toIdx === -1) {
            dragId.current = null;
            overId.current = null;
            return;
        }

        const previous = steps.map((s) => ({ ...s }));
        const reordered = [...steps];
        const [moved] = reordered.splice(fromIdx, 1);

        if (!moved) {
            dragId.current = null;
            overId.current = null;
            return;
        }

        reordered.splice(toIdx, 0, moved);

        const updated = reordered.map((s, i) => ({
            ...s,
            stepIndex: i,
        }));

        setSteps(updated);
        setError(null);

        try {
            const res = await fetch(
                `/api/campaigns/${encodeURIComponent(
                    campaignId
                )}/sequence-steps/reorder`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        stepIds: updated.map((s) => s.id),
                    }),
                }
            );

            if (!res.ok) {
                throw new Error(
                    `Failed to reorder sequence (${res.status})`
                );
            }
        } catch (err) {
            setSteps(previous);
            setError(
                err instanceof Error
                    ? err.message
                    : "Failed to reorder sequence."
            );
        } finally {
            dragId.current = null;
            overId.current = null;
            setDraggingId(null);
        }
    }, [campaignId, steps]);

    const handleDragStart = useCallback((id: string) => {
        dragId.current = id;
        overId.current = id;
        setDraggingId(id);
    }, []);

    const handleDragOver = useCallback(
        (_event: React.DragEvent, id: string) => {
            if (!dragId.current || dragId.current === id) return;
            overId.current = id;
        },
        []
    );

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <svg
                    className="animate-spin text-[var(--red-text)]"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
            </div>
        );
    }

    return (
        <div
            className="min-h-full overflow-y-auto"
            style={{
                backgroundImage:
                    "radial-gradient(circle, rgba(255,255,255,0.035) 1px, transparent 1px)",
                backgroundSize: "20px 20px",
            }}
        >
            <div className="py-8 px-4">
                <div className="flex items-center justify-between max-w-xs mx-auto mb-6">
                    <div>
                        <h2 className="text-sm font-semibold font-display text-[var(--text-primary)]">
                            Outreach Sequence
                        </h2>
                        <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                            {steps.length}/10 steps · click a node to edit
                        </p>
                    </div>

                    <button
                        onClick={handleAdd}
                        disabled={adding || steps.length >= 10}
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] active:scale-[0.97] transition-all duration-150 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        {adding ? (
                            <Spinner />
                        ) : (
                            <svg
                                width="10"
                                height="10"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                            >
                                <line x1="12" y1="5" x2="12" y2="19" />
                                <line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                        )}
                        Add Step
                    </button>
                </div>

                {error && (
                    <div
                        role="alert"
                        className="max-w-xs mx-auto mb-5 flex items-center gap-2 px-4 py-3 rounded-xl bg-red-400/5 border border-red-400/20 text-xs text-red-400"
                    >
                        <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                        >
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>

                        <span className="min-w-0 flex-1">
                            {error}
                        </span>

                        <button
                            onClick={() => setError(null)}
                            className="ml-auto hover:underline focus-visible:outline-none flex-shrink-0"
                        >
                            Dismiss
                        </button>
                    </div>
                )}

                {steps.length === 0 ? (
                    <div className="max-w-xs mx-auto flex flex-col items-center justify-center py-16 gap-4 border border-dashed border-[var(--border)] rounded-xl text-center bg-[var(--surface)]/50">
                        <div className="w-12 h-12 rounded-full bg-[var(--surface-2)] flex items-center justify-center text-[var(--text-muted)]">
                            <svg
                                width="20"
                                height="20"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                            </svg>
                        </div>

                        <div>
                            <p className="text-sm font-medium text-[var(--text-secondary)]">
                                No sequence steps
                            </p>
                            <p className="text-xs text-[var(--text-muted)] mt-1 max-w-[220px]">
                                Build your outreach flow. The AI uses these as a
                                blueprint per lead.
                            </p>
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
                    <div className="flex flex-col items-center">
                        <EntryNode />

                        {steps.map((step, i) => (
                            <Fragment key={step.id}>
                                <DelayConnector
                                    step={step}
                                    onChange={handleChange}
                                    saving={savingId === step.id}
                                />

                                <StepNode
                                    step={step}
                                    index={i}
                                    isExpanded={expandedId === step.id}
                                    onToggleExpand={() =>
                                        setExpandedId((prev) =>
                                            prev === step.id
                                                ? null
                                                : step.id
                                        )
                                    }
                                    onChange={handleChange}
                                    onDelete={handleDelete}
                                    saving={savingId === step.id}
                                    deleting={deletingId === step.id}
                                    onDragStart={handleDragStart}
                                    onDragOver={handleDragOver}
                                    onDrop={handleDrop}
                                    isDragging={draggingId === step.id}
                                />
                            </Fragment>
                        ))}

                        <div className="flex flex-col items-center mt-0">
                            <div className="w-px h-5 bg-[var(--border)]" />

                            <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-[var(--border)] bg-[var(--surface)] shadow-md">
                                <svg
                                    width="11"
                                    height="11"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="text-emerald-400"
                                    aria-hidden="true"
                                >
                                    <polyline points="20 6 9 17 4 12" />
                                </svg>

                                <span className="text-[10px] font-semibold text-[var(--text-secondary)]">
                                    Sequence Complete
                                </span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
