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
    businessDescription: string | null;
    valueProposition: string | null;
    provenStats: ProvenStat[] | null;
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

interface ProvenStat {
    metric: string;
    value: string;
    context: string;
}

interface OptionItem {
    id: string;
    domain?: string;
    emailAddress?: string;
    name?: string;
    label?: string;
    accountId?: string;
    health?: string;
    warmupEnabled?: boolean;
}

function formatHour(hour: number): string {
    if (hour === 0 || hour === 24) return "12 AM";
    if (hour === 12) return "12 PM";
    return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
}

type StepType = "email" | "linkedin_connect" | "linkedin_message" | "wait";

interface SequenceStep {
    id: string;
    type: StepType;
    waitDays: number;
    label: string;
    businessDaysOnly?: boolean;
    subject?: string;
    body?: string;
}

const STEP_META: Record<StepType, { icon: React.ReactNode; color: string; border: string; bg: string; label: string }> = {
    email: {
        label: "Email",
        color: "text-sky-400",
        border: "border-sky-400/30",
        bg: "bg-sky-400/8",
        icon: (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
        ),
    },
    linkedin_connect: {
        label: "LinkedIn Connect",
        color: "text-blue-400",
        border: "border-blue-400/30",
        bg: "bg-blue-400/8",
        icon: (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" /><rect x="2" y="9" width="4" height="12" /><circle cx="4" cy="4" r="2" />
            </svg>
        ),
    },
    linkedin_message: {
        label: "LinkedIn Message",
        color: "text-indigo-400",
        border: "border-indigo-400/30",
        bg: "bg-indigo-400/8",
        icon: (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
        ),
    },
    wait: {
        label: "Wait",
        color: "text-amber-400",
        border: "border-amber-400/30",
        bg: "bg-amber-400/8",
        icon: (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
        ),
    },
};

function stepId() {
    return Math.random().toString(36).slice(2, 9);
}

function ProvenStatsRepeater({
    stats,
    onChange,
    disabled,
    inputCls,
}: {
    stats: ProvenStat[];
    onChange: (stats: ProvenStat[]) => void;
    disabled?: boolean;
    inputCls: string;
}) {
    const MAX = 5;

    function addRow() {
        if (stats.length >= MAX) return;
        onChange([...stats, { metric: "", value: "", context: "" }]);
    }

    function removeRow(idx: number) {
        onChange(stats.filter((_, i) => i !== idx));
    }

    function updateRow(idx: number, field: keyof ProvenStat, val: string) {
        onChange(stats.map((s, i) => i === idx ? { ...s, [field]: val } : s));
    }

    return (
        <div className="space-y-3">
            {stats.length === 0 && (
                <p className="text-xs text-[var(--text-muted)] italic">
                    No proof points yet. Add up to {MAX} real, verifiable stats.
                </p>
            )}

            {stats.map((stat, idx) => (
                <div
                    key={idx}
                    className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-start"
                >
                    <div>
                        {idx === 0 && (
                            <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Metric</span>
                        )}
                        <input
                            type="text"
                            placeholder="e.g. Reply rate increase"
                            value={stat.metric}
                            disabled={disabled}
                            onChange={e => updateRow(idx, "metric", e.target.value)}
                            className={inputCls}
                            aria-label={`Proof point ${idx + 1} metric`}
                        />
                    </div>
                    <div>
                        {idx === 0 && (
                            <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Value</span>
                        )}
                        <input
                            type="text"
                            placeholder="e.g. 34%"
                            value={stat.value}
                            disabled={disabled}
                            onChange={e => updateRow(idx, "value", e.target.value)}
                            className={inputCls}
                            aria-label={`Proof point ${idx + 1} value`}
                        />
                    </div>
                    <div>
                        {idx === 0 && (
                            <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Context</span>
                        )}
                        <input
                            type="text"
                            placeholder="e.g. avg across SaaS campaigns, last 90 days"
                            value={stat.context}
                            disabled={disabled}
                            onChange={e => updateRow(idx, "context", e.target.value)}
                            className={inputCls}
                            aria-label={`Proof point ${idx + 1} context`}
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => removeRow(idx)}
                        disabled={disabled}
                        className={`p-1.5 rounded hover:bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--red-text)] transition-colors flex-shrink-0 ${idx === 0 ? "mt-5" : ""}`}
                        aria-label={`Remove proof point ${idx + 1}`}
                    >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>
            ))}

            {stats.length < MAX && (
                <button
                    type="button"
                    onClick={addRow}
                    disabled={disabled}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--red-text)] hover:text-white transition-colors disabled:opacity-40"
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    Add proof point ({stats.length}/{MAX})
                </button>
            )}
        </div>
    );
}

function buildDefaultSteps(followUpDelayDays: number, followUpMaxSteps: number): SequenceStep[] {
    const steps: SequenceStep[] = [{ id: stepId(), type: "email", waitDays: 0, label: "Initial Email", businessDaysOnly: true }];
    for (let i = 0; i < Math.min(followUpMaxSteps, 6); i++) {
        steps.push({ id: stepId(), type: "email", waitDays: followUpDelayDays, label: `Follow-up ${i + 1}`, businessDaysOnly: true });
    }
    return steps;
}

function SequenceBuilder({
    steps,
    onChange,
}: {
    steps: SequenceStep[];
    onChange: (steps: SequenceStep[]) => void;
}) {
    const [dragIdx, setDragIdx] = useState<number | null>(null);
    const [overIdx, setOverIdx] = useState<number | null>(null);
    const [expandedStepId, setExpandedStepId] = useState<string | null>(null);

    function addStep(type: StepType) {
        const defaultWait = type === "wait" ? 1 : 3;
        onChange([
            ...steps,
            {
                id: stepId(),
                type,
                waitDays: defaultWait,
                label: STEP_META[type].label,
                businessDaysOnly: true
            }
        ]);
    }

    function removeStep(idx: number) {
        onChange(steps.filter((_, i) => i !== idx));
    }

    function updateStep(idx: number, patch: Partial<SequenceStep>) {
        onChange(steps.map((s, i) => i === idx ? { ...s, ...patch } : s));
    }

    function onDragStart(idx: number) {
        setDragIdx(idx);
    }

    function onDragOver(e: React.DragEvent, idx: number) {
        e.preventDefault();
        setOverIdx(idx);
    }

    function onDrop(idx: number) {
        if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setOverIdx(null); return; }
        const next = [...steps];
        const [moved] = next.splice(dragIdx, 1);
        next.splice(idx, 0, moved);
        onChange(next);
        setDragIdx(null);
        setOverIdx(null);
    }

    function onDragEnd() {
        setDragIdx(null);
        setOverIdx(null);
    }

    function applyTemplate(type: "cold_intro" | "standard_followup" | "re_engagement") {
        if (steps.length > 0 && !window.confirm("Applying this template will overwrite your current sequence. Continue?")) {
            return;
        }
        if (type === "cold_intro") {
            onChange([
                {
                    id: stepId(),
                    type: "email",
                    waitDays: 0,
                    label: "Cold Intro",
                    businessDaysOnly: true,
                    subject: "Re: Quick question about {{companyName}}",
                    body: "Hi {{firstName}},\n\nI noticed you are running {{companyName}}. I wanted to reach out because we help companies like yours scale outreach automatically using AI...\n\nBest,\n{{senderName}}"
                }
            ]);
        } else if (type === "standard_followup") {
            onChange([
                {
                    id: stepId(),
                    type: "email",
                    waitDays: 0,
                    label: "Cold Intro",
                    businessDaysOnly: true,
                    subject: "Re: Quick question about {{companyName}}",
                    body: "Hi {{firstName}},\n\nI noticed you are running {{companyName}}. I wanted to reach out because we help companies like yours scale outreach automatically using AI...\n\nBest,\n{{senderName}}"
                },
                {
                    id: stepId(),
                    type: "email",
                    waitDays: 3,
                    label: "Quick Follow-up",
                    businessDaysOnly: true,
                    subject: "Quick thoughts?",
                    body: "Hi {{firstName}},\n\nI wanted to follow up on my last email. Do you have 5 minutes this week for a quick chat?\n\nBest,\n{{senderName}}"
                },
                {
                    id: stepId(),
                    type: "email",
                    waitDays: 3,
                    label: "Value follow-up",
                    businessDaysOnly: true,
                    subject: "Re: Quick question about {{companyName}}",
                    body: "Hi {{firstName}},\n\nI wanted to share a quick case study of how we helped a similar company scale their bookings by 3x. Let me know if you'd like to see it.\n\nBest,\n{{senderName}}"
                }
            ]);
        } else if (type === "re_engagement") {
            onChange([
                {
                    id: stepId(),
                    type: "linkedin_connect",
                    waitDays: 0,
                    label: "LinkedIn Connection",
                    businessDaysOnly: true,
                    body: "Hi {{firstName}},\n\nLove what you're building at {{companyName}}. Let's connect!"
                },
                {
                    id: stepId(),
                    type: "linkedin_message",
                    waitDays: 2,
                    label: "LinkedIn Message Follow-up",
                    businessDaysOnly: true,
                    body: "Hi {{firstName}},\n\nThanks for connecting! I wanted to check if you're open to exploring new ways to automate outreach..."
                }
            ]);
        }
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-2 p-3 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Starter Templates
                </span>
                <div className="flex gap-2 flex-wrap">
                    <button
                        type="button"
                        onClick={() => applyTemplate("cold_intro")}
                        className="px-2.5 py-1 bg-[var(--surface)] hover:bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--border-red)] rounded text-[11px] text-[var(--text-secondary)] hover:text-white transition-colors"
                    >
                        Cold Intro (1 step)
                    </button>
                    <button
                        type="button"
                        onClick={() => applyTemplate("standard_followup")}
                        className="px-2.5 py-1 bg-[var(--surface)] hover:bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--border-red)] rounded text-[11px] text-[var(--text-secondary)] hover:text-white transition-colors"
                    >
                        Standard Follow-up (3 steps)
                    </button>
                    <button
                        type="button"
                        onClick={() => applyTemplate("re_engagement")}
                        className="px-2.5 py-1 bg-[var(--surface)] hover:bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--border-red)] rounded text-[11px] text-[var(--text-secondary)] hover:text-white transition-colors"
                    >
                        Re-engagement (2 steps)
                    </button>
                </div>
            </div>

            {steps.length > 4 && (
                <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-500">
                    <svg className="flex-shrink-0 animate-pulse" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="m10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                        <line x1="12" y1="9" x2="12" y2="13"/>
                        <line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                    <span className="text-[11px] font-medium">
                        Sequences over 4 steps can increase spam risk.
                    </span>
                </div>
            )}

            <div className="space-y-0">
                {steps.map((step, idx) => {
                    const meta = STEP_META[step.type];
                    const isDragging = dragIdx === idx;
                    const isOver = overIdx === idx && dragIdx !== idx;
                    const isExpanded = expandedStepId === step.id;
                    return (
                        <div key={step.id} className="relative flex">
                            <div className="flex flex-col items-center mr-4 flex-shrink-0" aria-hidden="true">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center border ${meta.border} ${meta.bg} ${meta.color} flex-shrink-0 z-10`}>
                                    {meta.icon}
                                </div>
                                {idx < steps.length - 1 && (
                                    <div className="w-px flex-1 min-h-[40px] bg-[var(--border)] my-1" />
                                )}
                            </div>

                            <div
                                draggable
                                onDragStart={() => onDragStart(idx)}
                                onDragOver={(e) => onDragOver(e, idx)}
                                onDrop={() => onDrop(idx)}
                                onDragEnd={onDragEnd}
                                className={`flex-1 mb-3 rounded-xl border transition-all duration-150 cursor-grab active:cursor-grabbing ${
                                    isDragging ? "opacity-40 scale-[0.98]" : "opacity-100"
                                } ${isOver ? "border-[var(--red)]/40 bg-[var(--red-glow)]" : "border-[var(--border)] bg-[var(--surface)]"}`}
                            >
                                <div className="flex items-center gap-3 px-4 py-3 flex-wrap sm:flex-nowrap">
                                    <svg className="text-[var(--text-muted)] flex-shrink-0 cursor-grab" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-label="Drag to reorder">
                                        <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
                                        <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
                                    </svg>

                                    <span className={`text-[10px] font-bold uppercase tracking-wider ${meta.color} flex-shrink-0`}>
                                        Step {idx + 1}
                                    </span>

                                    <select
                                        value={step.type}
                                        onChange={(e) => updateStep(idx, { type: e.target.value as StepType, label: STEP_META[e.target.value as StepType].label })}
                                        className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-red)] transition-colors cursor-pointer"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <option value="email">Email</option>
                                        <option value="linkedin_connect">LinkedIn Connect</option>
                                        <option value="linkedin_message">LinkedIn Message</option>
                                        <option value="wait">Wait</option>
                                    </select>

                                    <input
                                        type="text"
                                        value={step.label}
                                        onChange={(e) => updateStep(idx, { label: e.target.value })}
                                        placeholder="Step label"
                                        className="flex-1 min-w-0 bg-transparent border-b border-[var(--border)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-red)] py-0.5 transition-colors"
                                        onClick={(e) => e.stopPropagation()}
                                    />

                                    {idx > 0 && (
                                        <div className="flex items-center gap-3 flex-wrap flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                            <div className="flex items-center gap-1.5">
                                                <svg className="text-[var(--text-muted)]" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                                                <span className="text-[10px] text-[var(--text-muted)]">Wait</span>
                                                <input
                                                    type="number"
                                                    min={0}
                                                    max={90}
                                                    value={step.waitDays}
                                                    onChange={(e) => updateStep(idx, { waitDays: Math.max(0, Number(e.target.value)) })}
                                                    className="w-10 bg-[var(--surface-2)] border border-[var(--border)] rounded px-1.5 py-0.5 text-xs text-[var(--text-primary)] text-center focus:outline-none focus:border-[var(--border-red)] transition-colors"
                                                />
                                                <span className="text-[10px] text-[var(--text-muted)]">days</span>
                                            </div>
                                            <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                                <input
                                                    type="checkbox"
                                                    checked={step.businessDaysOnly !== false}
                                                    onChange={(e) => updateStep(idx, { businessDaysOnly: e.target.checked })}
                                                    className="rounded border-[var(--border)] bg-[var(--surface-2)] text-[var(--red-text)] focus:ring-[var(--red)]/20 w-3 h-3 accent-[var(--red)] cursor-pointer"
                                                />
                                                <span className="text-[10px] text-[var(--text-muted)]">Business days only</span>
                                            </label>
                                        </div>
                                    )}

                                    <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                        <button
                                            type="button"
                                            onClick={() => setExpandedStepId(isExpanded ? null : step.id)}
                                            className="p-1 rounded hover:bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-white transition-colors"
                                            aria-label="Toggle preview"
                                        >
                                            {isExpanded ? (
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15" /></svg>
                                            ) : (
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
                                            )}
                                        </button>

                                        {steps.length > 1 && (
                                            <button
                                                type="button"
                                                onClick={() => removeStep(idx)}
                                                className="p-1 rounded hover:bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--red-text)] transition-colors"
                                                aria-label="Remove step"
                                            >
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {isExpanded && (
                                    <div className="px-4 pb-4 pt-1 border-t border-[var(--border)]/40 bg-[var(--surface-2)]/50 rounded-b-xl space-y-3 cursor-default" onClick={(e) => e.stopPropagation()}>
                                        {step.type === "email" ? (
                                            <div className="space-y-2 text-xs">
                                                <div>
                                                    <span className="font-semibold text-[var(--text-muted)] block mb-1">Subject Draft Preview</span>
                                                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded px-2.5 py-1.5 font-mono text-[var(--text-secondary)] select-all">
                                                        {step.subject || `Re: Quick question about {{companyName}}`}
                                                    </div>
                                                </div>
                                                <div>
                                                    <span className="font-semibold text-[var(--text-muted)] block mb-1">Body Draft Preview</span>
                                                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded px-2.5 py-1.5 font-mono text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed select-all">
                                                        {step.body || `Hi {{firstName}},\n\nI noticed you are running {{companyName}}. I wanted to reach out because we help companies like yours scale outreach automatically using AI...\n\nBest,\n{{senderName}}`}
                                                    </div>
                                                </div>
                                            </div>
                                        ) : step.type === "linkedin_connect" ? (
                                            <div className="text-xs">
                                                <span className="font-semibold text-[var(--text-muted)] block mb-1">Connection Note Preview</span>
                                                <div className="bg-[var(--surface)] border border-[var(--border)] rounded px-2.5 py-1.5 font-mono text-[var(--text-secondary)] whitespace-pre-wrap select-all">
                                                    {step.body || `Hi {{firstName}},\n\nLove what you're building at {{companyName}}. Let's connect!`}
                                                </div>
                                            </div>
                                        ) : step.type === "linkedin_message" ? (
                                            <div className="text-xs">
                                                <span className="font-semibold text-[var(--text-muted)] block mb-1">LinkedIn Message Preview</span>
                                                <div className="bg-[var(--surface)] border border-[var(--border)] rounded px-2.5 py-1.5 font-mono text-[var(--text-secondary)] whitespace-pre-wrap select-all">
                                                    {step.body || `Hi {{firstName}},\n\nThanks for connecting! I wanted to check if you're open to exploring new ways to automate outreach...`}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="text-xs text-[var(--text-muted)] italic">
                                                No message content associated with this wait step.
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="flex items-center gap-2 pt-1 pl-12">
                {(["email", "linkedin_connect", "linkedin_message", "wait"] as StepType[]).map((type) => {
                    const meta = STEP_META[type];
                    return (
                        <button
                            key={type}
                            type="button"
                            onClick={() => addStep(type)}
                            className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg border transition-all ${meta.border} ${meta.bg} ${meta.color} hover:opacity-80`}
                        >
                            {meta.icon}
                            + {meta.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
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
    const [sendWindowStart, setSendWindowStart] = useState("8");
    const [sendWindowEnd, setSendWindowEnd] = useState("18");
    const [sendWindowDays, setSendWindowDays] = useState<number[]>([1, 2, 3, 4, 5]);
    const [timezone, setTimezone] = useState("UTC");
    const [autoSendRepliesEnabled, setAutoSendRepliesEnabled] = useState(false);
    const [businessDescription, setBusinessDescription] = useState("");
    const [valueProposition, setValueProposition] = useState("");
    const [provenStats, setProvenStats] = useState<ProvenStat[]>([]);
    const [sequenceSteps, setSequenceSteps] = useState<SequenceStep[]>([
        { id: stepId(), type: "email", waitDays: 0, label: "Initial Email" },
    ]);

    const [domains, setDomains] = useState<OptionItem[]>([]);
    const [mailboxes, setMailboxes] = useState<OptionItem[]>([]);
    const [linkedInAccounts, setLinkedInAccounts] = useState<OptionItem[]>([]);

    const [activeTab, setActiveTab] = useState<"general" | "sequence" | "schedule" | "automation">("general");
    const [originalData, setOriginalData] = useState<CampaignData | null>(null);
    const [originalSequence, setOriginalSequence] = useState<SequenceStep[]>([]);

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
                setSendWindowStart(String(cData.sendWindowStart ?? 8));
                setSendWindowEnd(String(cData.sendWindowEnd ?? 18));
                setSendWindowDays(cData.sendWindowDays ?? [1, 2, 3, 4, 5]);
                setTimezone(cData.timezone || "UTC");
                setAutoSendRepliesEnabled(cData.autoSendRepliesEnabled ?? false);
                setBusinessDescription(cData.businessDescription || "");
                setValueProposition(cData.valueProposition || "");
                setProvenStats(Array.isArray(cData.provenStats) ? cData.provenStats : []);
                const initialSteps = buildDefaultSteps(cData.followUpDelayDays ?? 3, cData.followUpMaxSteps ?? 2);
                setSequenceSteps(initialSteps);

                setOriginalData(cData);
                setOriginalSequence(initialSteps);

            } catch (err) {
                setError(err instanceof Error ? err.message : "Something went wrong");
            } finally {
                setLoading(false);
            }
        }

        load();
    }, [id]);

    const isDirty = originalData ? (
        name !== (originalData.name || "") ||
        description !== (originalData.description || "") ||
        icpDescription !== (originalData.icpDescription || "") ||
        targetIndustry !== (originalData.targetIndustry || "") ||
        targetRegion !== (originalData.targetRegion || "") ||
        dailySendLimit !== String(originalData.dailySendLimit ?? 25) ||
        senderDomainId !== (originalData.senderDomainId || "") ||
        senderMailboxId !== (originalData.senderMailboxId || "") ||
        linkedInAccountId !== (originalData.linkedInAccountId || "") ||
        sendWindowStart !== String(originalData.sendWindowStart ?? 8) ||
        sendWindowEnd !== String(originalData.sendWindowEnd ?? 18) ||
        timezone !== (originalData.timezone || "UTC") ||
        autoSendRepliesEnabled !== (originalData.autoSendRepliesEnabled ?? false) ||
        businessDescription !== (originalData.businessDescription || "") ||
        valueProposition !== (originalData.valueProposition || "") ||
        JSON.stringify(provenStats) !== JSON.stringify(originalData.provenStats ?? []) ||
        JSON.stringify(sendWindowDays) !== JSON.stringify(originalData.sendWindowDays ?? [1, 2, 3, 4, 5]) ||
        JSON.stringify(sequenceSteps.map(s => ({ type: s.type, waitDays: s.waitDays, label: s.label, businessDaysOnly: s.businessDaysOnly !== false }))) !==
            JSON.stringify(originalSequence.map(s => ({ type: s.type, waitDays: s.waitDays, label: s.label, businessDaysOnly: s.businessDaysOnly !== false })))
    ) : false;

    useEffect(() => {
        if (!isDirty) return;
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = "You have unsaved changes. Are you sure you want to leave?";
        };
        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => window.removeEventListener("beforeunload", handleBeforeUnload);
    }, [isDirty]);

    async function handleSave(e: React.FormEvent) {
        e.preventDefault();
        if (saving) return;
        setSaving(true);
        setSaveError(null);

        const emailSteps = sequenceSteps.filter(s => s.type === "email");
        const followUpMaxSteps = Math.max(0, emailSteps.length - 1);
        const delays = sequenceSteps.filter((_, i) => i > 0).map(s => s.waitDays).filter(d => d > 0);
        const followUpDelayDays = delays.length > 0 ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : 3;

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
                followUpDelayDays,
                followUpMaxSteps,
                sendWindowStart: Math.max(0, Math.min(23, Number(sendWindowStart) || 8)),
                sendWindowEnd: Math.max(0, Math.min(23, Number(sendWindowEnd) || 18)),
                sendWindowDays,
                timezone,
                autoSendRepliesEnabled,
                businessDescription: businessDescription.trim() || null,
                valueProposition: valueProposition.trim() || null,
                provenStats: provenStats.filter(s => s.metric.trim() && s.value.trim() && s.context.trim()),
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
                    <svg className="animate-spin text-[var(--red-text)]" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                    <Link href="/dashboard/campaigns" className="text-xs text-[var(--red-text)] hover:underline">
                        &larr; Back to Campaigns
                    </Link>
                </div>
            </div>
        );
    }    return (
        <div className="flex flex-col h-full overflow-hidden">
            <TopBar
                title="Edit Campaign"
                breadcrumbs={[
                    { label: "Campaigns", href: "/dashboard/campaigns" },
                    { label: name || "Campaign", href: `/dashboard/campaigns/${id}` }
                ]}
                campaignBadge={name ? { name, href: `/dashboard/campaigns/${id}` } : undefined}
            />

            <div className="border-b border-[var(--border)] bg-[var(--surface)] flex-shrink-0 flex items-center justify-between px-6">
                <div className="flex gap-6">
                    {(["general", "sequence", "schedule", "automation"] as const).map(tab => {
                        const active = activeTab === tab;
                        const label = tab.charAt(0).toUpperCase() + tab.slice(1);
                        const displayLabel = tab === "sequence" ? `Sequence (${sequenceSteps.length} step${sequenceSteps.length !== 1 ? "s" : ""})` : label;
                        return (
                            <button
                                key={tab}
                                type="button"
                                onClick={() => setActiveTab(tab)}
                                className={[
                                    "py-3.5 text-[11px] font-semibold uppercase tracking-wider border-b-2 transition-all relative focus:outline-none",
                                    active
                                        ? "border-[var(--red)] text-[var(--red-text)]"
                                        : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                                ].join(" ")}
                            >
                                {displayLabel}
                            </button>
                        );
                    })}
                </div>
                {isDirty && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[9px] font-semibold bg-amber-500/10 text-amber-500 border border-amber-500/20 animate-pulse">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        Unsaved Changes
                    </span>
                )}
            </div>

            <form onSubmit={handleSave} className="flex-1 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto p-6 max-w-3xl w-full mx-auto space-y-6">
                    {activeTab === "general" && (
                        <>
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
                                <div>
                                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Copywriting Intelligence</h3>
                                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                                        These inputs are injected directly into every email the AI writes for this campaign — the more specific, the better the output.
                                    </p>
                                </div>

                                <div>
                                    <label className={labelCls} htmlFor="edit-biz-desc">
                                        What your company actually does
                                        <span className="ml-1.5 text-[10px] font-normal text-[var(--text-muted)] normal-case tracking-normal">(used to ground the pitch)</span>
                                    </label>
                                    <textarea
                                        id="edit-biz-desc"
                                        rows={3}
                                        className={`${inputCls} resize-none leading-relaxed`}
                                        placeholder="e.g. We help B2B SaaS sales teams replace manual SDR prospecting with AI-generated, personalised cold emails that use real intent signals from LinkedIn, job posts and news."
                                        value={businessDescription}
                                        onChange={e => setBusinessDescription(e.target.value)}
                                        maxLength={2000}
                                    />
                                    <p className="text-[10px] text-[var(--text-muted)] mt-1 text-right">{businessDescription.length}/2000</p>
                                </div>

                                <div>
                                    <label className={labelCls} htmlFor="edit-value-prop">
                                        Your value proposition
                                        <span className="ml-1.5 text-[10px] font-normal text-[var(--text-muted)] normal-case tracking-normal">(in your own words)</span>
                                    </label>
                                    <textarea
                                        id="edit-value-prop"
                                        rows={2}
                                        className={`${inputCls} resize-none leading-relaxed`}
                                        placeholder="e.g. We save outbound teams 6+ hours per week of manual research, and our customers see 2–4× higher reply rates compared to generic sequences."
                                        value={valueProposition}
                                        onChange={e => setValueProposition(e.target.value)}
                                        maxLength={1000}
                                    />
                                    <p className="text-[10px] text-[var(--text-muted)] mt-1 text-right">{valueProposition.length}/1000</p>
                                </div>

                                <div>
                                    <label className={labelCls}>
                                        Proven stats
                                        <span className="ml-1.5 text-[10px] font-normal text-[var(--text-muted)] normal-case tracking-normal">
                                            Real, verifiable numbers only — the AI will cite these verbatim. If empty, the AI will use qualitative language instead of inventing figures.
                                        </span>
                                    </label>
                                    <ProvenStatsRepeater
                                        stats={provenStats}
                                        onChange={setProvenStats}
                                        disabled={saving}
                                        inputCls={inputCls}
                                    />
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
                                            {mailboxes.map(m => {
                                                let statusPrefix = "🟢";
                                                let statusText = "Warmed";
                                                if (m.health === "BLOCKED") {
                                                    statusPrefix = "🔴";
                                                    statusText = "Blocked";
                                                } else if (m.warmupEnabled) {
                                                    statusPrefix = "🟡";
                                                    statusText = "Warming";
                                                }
                                                return (
                                                    <option key={m.id} value={m.id} disabled={m.health === "BLOCKED"}>
                                                        {statusPrefix} {statusText} — {m.emailAddress}
                                                    </option>
                                                );
                                            })}
                                        </select>
                                    </div>
                                </div>

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
                            </div>
                        </>
                    )}

                    {activeTab === "sequence" && (
                        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-5">
                            <div className="flex items-start justify-between">
                                <div>
                                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Sequence Builder</h3>
                                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Drag steps to reorder. Each step runs after the configured wait period.</p>
                                </div>
                                <span className="text-[10px] font-semibold text-[var(--text-muted)] bg-[var(--surface-2)] border border-[var(--border)] px-2 py-1 rounded-full">
                                    {sequenceSteps.length} step{sequenceSteps.length !== 1 ? "s" : ""}
                                </span>
                            </div>

                            <SequenceBuilder steps={sequenceSteps} onChange={setSequenceSteps} />
                        </div>
                    )}

                    {activeTab === "schedule" && (
                        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-5">
                            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Send Schedule</h3>

                            <div className="space-y-3 pb-2 border-b border-[var(--border)]/45">
                                <div className="flex justify-between items-center">
                                    <label className={labelCls} htmlFor="edit-limit">Daily Send Limit</label>
                                    <div className="text-xs font-bold text-white bg-[var(--surface-2)] px-2 py-0.5 rounded border border-[var(--border)]">
                                        {dailySendLimit} emails/day
                                    </div>
                                </div>
                                <input
                                    id="edit-limit"
                                    type="range"
                                    min="1"
                                    max="500"
                                    step="5"
                                    value={dailySendLimit}
                                    onChange={e => setDailySendLimit(e.target.value)}
                                    className="w-full accent-[var(--red)] cursor-pointer"
                                />
                                <div className="flex gap-2">
                                    {[25, 50, 100, 200].map(val => (
                                        <button
                                            key={val}
                                            type="button"
                                            onClick={() => setDailySendLimit(String(val))}
                                            className={[
                                                "px-2.5 py-1 rounded text-[10px] font-semibold border transition-colors",
                                                Number(dailySendLimit) === val
                                                    ? "bg-[var(--red-glow)] border-[var(--border-red)] text-[var(--red-text)]"
                                                    : "bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-white"
                                            ].join(" ")}
                                        >
                                            {val}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-4 pb-2 border-b border-[var(--border)]/45">
                                <div className="flex justify-between items-center bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4">
                                    <div className="space-y-1">
                                        <span className="text-xs text-[var(--text-secondary)]">Sending Window</span>
                                        <div className="text-sm font-bold text-white">
                                            {formatHour(Number(sendWindowStart))} – {formatHour(Number(sendWindowEnd))}
                                        </div>
                                    </div>
                                    <div className="text-[10px] font-semibold bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded border border-indigo-500/20">
                                        {Number(sendWindowEnd) - Number(sendWindowStart)} hrs/day
                                    </div>
                                </div>
                                <div className="space-y-3">
                                    <div>
                                        <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
                                            <span>Start Time</span>
                                            <span>{formatHour(Number(sendWindowStart))}</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0"
                                            max="23"
                                            value={sendWindowStart}
                                            onChange={e => {
                                                const val = Number(e.target.value);
                                                if (val < Number(sendWindowEnd)) {
                                                    setSendWindowStart(String(val));
                                                }
                                            }}
                                            className="w-full accent-[var(--red)] cursor-pointer"
                                        />
                                    </div>
                                    <div>
                                        <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
                                            <span>End Time</span>
                                            <span>{formatHour(Number(sendWindowEnd))}</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0"
                                            max="24"
                                            value={sendWindowEnd}
                                            onChange={e => {
                                                const val = Number(e.target.value);
                                                if (val > Number(sendWindowStart)) {
                                                    setSendWindowEnd(String(val));
                                                }
                                            }}
                                            className="w-full accent-[var(--red)] cursor-pointer"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="pb-2 border-b border-[var(--border)]/45">
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
                                                        ? "bg-[var(--red-glow)] border-[var(--border-red)] text-[var(--red-text)]"
                                                        : "bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--border-red)]/60",
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
                    )}

                    {activeTab === "automation" && (
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
                    )}

                    {saveError && (
                        <div className="flex items-start gap-2 p-3 bg-[var(--red-glow)] border border-[var(--border-red)] rounded-xl">
                            <svg className="flex-shrink-0 mt-0.5 text-[var(--red-text)]" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="12" y1="8" x2="12" y2="12" />
                                <line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                            <p className="text-xs text-[var(--red-text)]">{saveError}</p>
                        </div>
                    )}
                </div>

                <div className="bg-[var(--surface)] border-t border-[var(--border)] p-4 flex-shrink-0">
                    <div className="max-w-3xl w-full mx-auto flex items-center justify-between px-6">
                        <div className="flex items-center gap-2">
                            {isDirty && (
                                <span className="text-xs text-amber-500 font-medium">
                                    You have unsaved changes
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-3">
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
                    </div>
                </div>
            </form>
        </div>
    );
}
