"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";

const WEIGHT_KEYS = [
    { key: "icpMatch",       label: "ICP Match",       description: "How closely the company matches your defined customer profile" },
    { key: "intentStrength", label: "Intent Strength",  description: "Strength of buying intent signals (job posts, tech searches)" },
    { key: "fundingSignals", label: "Funding Signals",  description: "Recent funding rounds or investment activity" },
    { key: "hiringVelocity", label: "Hiring Velocity",  description: "Rate of team growth as a proxy for budget and scale" },
    { key: "techFit",        label: "Tech Fit",         description: "Alignment of the company tech stack with your product" },
    { key: "recency",        label: "Recency",          description: "How recently the qualifying signals were observed" },
] as const;

type WeightKey = typeof WEIGHT_KEYS[number]["key"];
type Weights = Record<WeightKey, number>;

const DEFAULTS: Weights = {
    icpMatch: 0.25,
    intentStrength: 0.30,
    fundingSignals: 0.15,
    hiringVelocity: 0.15,
    techFit: 0.10,
    recency: 0.05,
};

/* Segment colours — complementary indigo/violet palette */
const SEGMENT_COLORS: string[] = [
    "#6366F1",
    "#818CF8",
    "#A78BFA",
    "#C4B5FD",
    "#4F46E5",
    "#38BDF8",
];

function sumWeights(w: Weights): number {
    return (Object.values(w) as number[]).reduce((a, b) => a + b, 0);
}

/* ─── Donut ring ─────────────────────────────────────────────────────────────── */

function WeightRing({ weights }: { weights: Weights }) {
    const cx = 80, cy = 80, r = 60;
    const circumference = 2 * Math.PI * r;
    let offset = 0;
    const total = sumWeights(weights);
    const balanced = Math.abs(total - 1) < 0.001;

    const segments = WEIGHT_KEYS.map(({ key }, i) => {
        const pct  = weights[key];
        const dash = circumference * pct;
        const gap  = circumference - dash;
        const el = (
            <circle
                key={key}
                cx={cx} cy={cy} r={r}
                fill="none"
                stroke={SEGMENT_COLORS[i]}
                strokeWidth={14}
                strokeDasharray={`${dash} ${gap}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
                style={{
                    transform: "rotate(-90deg)",
                    transformOrigin: `${cx}px ${cy}px`,
                    transition: "stroke-dasharray 0.2s ease",
                }}
            />
        );
        offset += dash;
        return el;
    });

    return (
        <div className="flex flex-col items-center gap-2">
            <svg width={160} height={160} viewBox="0 0 160 160">
                <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={14} />
                {segments}
                <text
                    x={cx} y={cy - 6}
                    textAnchor="middle"
                    fill={balanced ? SEGMENT_COLORS[0] : "var(--red)"}
                    fontSize={18}
                    fontFamily="monospace"
                    fontWeight="700"
                >
                    {Math.round(total * 100)}%
                </text>
                <text
                    x={cx} y={cy + 12}
                    textAnchor="middle"
                    fill="var(--text-muted)"
                    fontSize={9}
                    fontFamily="monospace"
                    letterSpacing="1"
                >
                    {balanced ? "BALANCED" : "UNBALANCED"}
                </text>
            </svg>
            <div className="flex flex-wrap gap-1.5 justify-center max-w-[200px]">
                {WEIGHT_KEYS.map(({ key, label }, i) => (
                    <div key={key} className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: SEGMENT_COLORS[i] }} />
                        <span className="text-[9px] text-[var(--text-muted)] font-mono tracking-wide">
                            {label.split(" ")[0].toUpperCase()}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

/* ─── Slider row ─────────────────────────────────────────────────────────────── */

interface SliderRowProps {
    label: string;
    description: string;
    value: number;
    color: string;
    onChange: (v: number) => void;
}

function SliderRow({ label, description, value, color, onChange }: SliderRowProps) {
    const pct = Math.round(value * 100);
    return (
        <div
            className="grid items-center gap-4 py-3 border-b border-[var(--border)]"
            style={{ gridTemplateColumns: "140px 1fr 56px" }}
        >
            <div>
                <p className="text-xs font-semibold text-[var(--text-primary)] tracking-tight">{label}</p>
                <p className="text-[10px] text-[var(--text-muted)] mt-0.5 leading-snug">{description}</p>
            </div>
            <input
                type="range"
                min={0} max={100} step={1}
                value={pct}
                onChange={e => onChange(Number(e.target.value) / 100)}
                aria-label={label}
                className="scoring-slider w-full h-1 rounded cursor-pointer appearance-none outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                style={{
                    background: `linear-gradient(to right, ${color} 0%, ${color} ${pct}%, var(--surface-2) ${pct}%, var(--surface-2) 100%)`,
                }}
            />
            <p className="text-right font-mono text-sm font-bold tabular-nums" style={{ color }}>{pct}%</p>
        </div>
    );
}

/* ─── Page ───────────────────────────────────────────────────────────────────── */

export default function ScoringWeightsPage({ params }: { params?: { id?: string } }) {
    const urlParams = useParams();
    const id = typeof urlParams.id === "string" ? urlParams.id : (params?.id ?? "");

    const [weights,     setWeights]     = useState<Weights>(DEFAULTS);
    const [saved,       setSaved]       = useState<Weights>(DEFAULTS);
    const [loading,     setLoading]     = useState(true);
    const [saving,      setSaving]      = useState(false);
    const [error,       setError]       = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState(false);

    useEffect(() => {
        if (!id) return;
        fetch(`/api/campaigns/${id}/scoring-weights`)
            .then(r => r.json())
            .then((data: Weights) => { setWeights(data); setSaved(data); })
            .catch(() => setError("Failed to load scoring weights"))
            .finally(() => setLoading(false));
    }, [id]);

    const handleChange = useCallback((key: WeightKey, value: number) => {
        setWeights(prev => ({ ...prev, [key]: value }));
        setSaveSuccess(false);
    }, []);

    const handleReset  = useCallback(() => { setWeights(DEFAULTS); setSaveSuccess(false); }, []);
    const handleRevert = useCallback(() => { setWeights(saved); setSaveSuccess(false); setError(null); }, [saved]);

    const handleSave = useCallback(async () => {
        const total = sumWeights(weights);
        if (Math.abs(total - 1) >= 0.001) {
            setError(`Weights sum to ${Math.round(total * 100)}% — adjust sliders to reach exactly 100%`);
            return;
        }
        setSaving(true); setError(null);
        try {
            const res = await fetch(`/api/campaigns/${id}/scoring-weights`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(weights),
            });
            if (!res.ok) {
                const data = await res.json() as { error?: string };
                throw new Error(data.error ?? "Save failed");
            }
            setSaved(weights);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Save failed");
        } finally {
            setSaving(false);
        }
    }, [weights, id]);

    const total    = sumWeights(weights);
    const balanced = Math.abs(total - 1) < 0.001;
    const dirty    = JSON.stringify(weights) !== JSON.stringify(saved);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-80 bg-[var(--surface)] rounded-xl border border-[var(--border)]">
                <svg className="animate-spin text-[var(--red)]" width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
            </div>
        );
    }

    return (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-7 max-w-2xl">
            {/* Range thumb global styles */}
            <style>{`
                .scoring-slider::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    width: 14px; height: 14px;
                    border-radius: 50%;
                    background: var(--text-primary);
                    box-shadow: 0 0 0 2px #6366F1;
                    cursor: pointer;
                }
                .scoring-slider::-moz-range-thumb {
                    width: 14px; height: 14px;
                    border-radius: 50%;
                    background: var(--text-primary);
                    box-shadow: 0 0 0 2px #6366F1;
                    cursor: pointer; border: none;
                }
            `}</style>

            <div className="flex items-start justify-between mb-7 gap-6">
                <div>
                    <h2 className="text-lg font-bold font-display text-[var(--text-primary)] tracking-tight">
                        Lead Scoring Weights
                    </h2>
                    <p className="mt-1.5 text-xs text-[var(--text-muted)] leading-relaxed max-w-xs">
                        Adjust how each dimension contributes to the final lead score for this campaign.
                        Changes apply to leads scored after saving.
                    </p>
                </div>
                <WeightRing weights={weights} />
            </div>

            <div>
                {WEIGHT_KEYS.map(({ key, label, description }, i) => (
                    <SliderRow
                        key={key}
                        label={label}
                        description={description}
                        value={weights[key]}
                        color={SEGMENT_COLORS[i]}
                        onChange={v => handleChange(key, v)}
                    />
                ))}
            </div>

            {/* Validation / success banners */}
            {error && (
                <div className="mt-4 px-3.5 py-2.5 rounded-lg bg-[var(--red-glow)] border border-[var(--border-red)] text-xs text-[var(--red)]">
                    {error}
                </div>
            )}
            {!balanced && !error && (
                <div className="mt-4 px-3.5 py-2.5 rounded-lg bg-sky-400/5 border border-sky-400/20 text-xs text-sky-400">
                    Weights sum to {Math.round(total * 100)}%. Adjust sliders until total reaches 100% to save.
                </div>
            )}
            {saveSuccess && (
                <div className="mt-4 px-3.5 py-2.5 rounded-lg bg-emerald-400/5 border border-emerald-400/20 text-xs text-emerald-400">
                    Scoring weights saved. New leads will use these weights.
                </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 justify-end mt-6">
                <button
                    onClick={handleRevert}
                    disabled={!dirty || saving}
                    className="px-4 py-2 rounded-lg border border-[var(--border)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                >
                    Revert
                </button>
                <button
                    onClick={handleReset}
                    disabled={saving}
                    className="px-4 py-2 rounded-lg border border-[var(--border)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] disabled:opacity-40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                >
                    Reset to defaults
                </button>
                <button
                    onClick={handleSave}
                    disabled={!balanced || saving || !dirty}
                    className={[
                        "px-5 py-2 rounded-lg text-xs font-semibold min-w-[88px] flex items-center justify-center gap-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]",
                        balanced && dirty
                            ? "bg-[#6366F1] hover:bg-[#4F46E5] text-white"
                            : "bg-[var(--surface-2)] text-[var(--text-muted)] cursor-not-allowed",
                    ].join(" ")}
                >
                    {saving && (
                        <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                        </svg>
                    )}
                    {saving ? "Saving…" : "Save weights"}
                </button>
            </div>
        </div>
    );
}
