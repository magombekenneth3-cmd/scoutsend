"use client";

import { useState } from "react";
import { OutreachAngle } from "@/app/api/research/research.api";

interface OutreachAngleSectionProps {
  angle: OutreachAngle;
}

export function OutreachAngleSection({ angle }: OutreachAngleSectionProps) {
  const [activeTalkTrack, setActiveTalkTrack] = useState(0);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [copiedSubject, setCopiedSubject] = useState<number | null>(null);

  async function copyText(text: string, key: string, setFn: (v: number | null) => void, idx: number) {
    try { await navigator.clipboard.writeText(text); } catch { return; }
    setFn(idx);
    setTimeout(() => setFn(null), 1500);
  }

  return (
    <div className="space-y-5">
      {/* Primary angle */}
      <div className="rounded-lg bg-[var(--red-glow)] border border-[var(--border-red)] px-4 py-3">
        <p className="text-[10px] font-semibold text-[var(--red)] uppercase tracking-widest mb-1.5">Primary angle</p>
        <p className="text-sm font-medium text-[var(--text-primary)] leading-relaxed">{angle.primaryAngle}</p>
        <p className="text-xs text-[var(--text-secondary)] mt-2 leading-relaxed">{angle.angleRationale}</p>
      </div>

      {/* Talk tracks */}
      <div>
        <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-2">Talk tracks</p>
        <div className="flex gap-1.5 mb-3">
          {angle.talkTracks.map((_, i) => (
            <button
              key={i}
              onClick={() => setActiveTalkTrack(i)}
              className={`text-[10px] font-semibold px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                activeTalkTrack === i
                  ? "bg-[var(--red)] text-white"
                  : "bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] border border-[var(--border)]"
              }`}
            >
              Track {i + 1}
            </button>
          ))}
        </div>

        {angle.talkTracks[activeTalkTrack] && (() => {
          const track = angle.talkTracks[activeTalkTrack];
          return (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] divide-y divide-[var(--border)]">
              {[
                { label: "Trigger", value: track.trigger },
                { label: "Hook", value: track.hook },
                { label: "Value prop", value: track.value },
                { label: "CTA", value: track.cta },
              ].map(({ label, value }, i) => (
                <div key={label} className="flex items-start gap-3 px-4 py-3 group">
                  <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest w-18 flex-shrink-0 pt-0.5">{label}</span>
                  <span className="text-xs text-[var(--text-secondary)] leading-relaxed flex-1">{value}</span>
                  <button
                    onClick={() => copyText(value, label, setCopiedIndex, i)}
                    aria-label={`Copy ${label}`}
                    className="flex-shrink-0 opacity-40 group-hover:opacity-100 focus-visible:opacity-100 w-6 h-6 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all cursor-pointer"
                  >
                    {copiedIndex === i
                      ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                      : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                    }
                  </button>
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {/* Subject lines */}
      {angle.subjectLineVariants && angle.subjectLineVariants.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-2">Subject line variants</p>
          <div className="space-y-1.5">
            {angle.subjectLineVariants.map((s, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] group">
                <span className="text-xs text-[var(--text-primary)] flex-1">{s}</span>
                <button
                  onClick={() => copyText(s, "subject", setCopiedSubject, i)}
                  aria-label={`Copy subject line ${i + 1}`}
                  className="flex-shrink-0 opacity-40 group-hover:opacity-100 focus-visible:opacity-100 w-6 h-6 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all cursor-pointer"
                >
                  {copiedSubject === i
                    ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                    : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                  }
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Opening line suggestion */}
      {angle.openingLineSuggestion && (
        <div className="bg-[var(--surface-2)] p-3 rounded-lg border border-[var(--border)] text-xs">
          <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">Opening Line Suggestion</p>
          <p className="text-[var(--text-primary)] italic leading-relaxed">"{angle.openingLineSuggestion}"</p>
        </div>
      )}

      {/* Warnings / Avoid */}
      {angle.warningsAndAvoid && angle.warningsAndAvoid.length > 0 && (
        <div className="p-3.5 rounded-lg bg-orange-400/5 border border-orange-400/10">
          <p className="text-[10px] font-semibold text-orange-400 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Watch-outs & Avoid list
          </p>
          <div className="space-y-1">
            {angle.warningsAndAvoid.map((w, idx) => (
              <p key={idx} className="text-xs text-[var(--text-secondary)] leading-relaxed">- {w}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
