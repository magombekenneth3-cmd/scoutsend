import { useState } from "react";

interface DiffViewProps {
    original: string;
    updated: string;
    label: string;
}

export function DiffView({ original, updated, label }: DiffViewProps) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
            <button
                onClick={() => setExpanded((e) => !e)}
                className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500"
            >
                <div className="flex items-center gap-2">
                    <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-violet-500"
                    >
                        <polyline points="16 3 21 3 21 8" />
                        <line x1="4" y1="20" x2="21" y2="3" />
                        <polyline points="21 16 21 21 16 21" />
                        <line x1="15" y1="15" x2="21" y2="21" />
                    </svg>
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                        AI diff — {label}
                    </span>
                    <span className="text-[10px] text-violet-600 dark:text-violet-400 bg-violet-100 dark:bg-violet-900/30 rounded px-1.5 py-0.5 font-medium">
                        edited
                    </span>
                </div>
                <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`text-slate-400 transition-transform duration-200 ${expanded ? "rotate-180" : ""
                        }`}
                >
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </button>

            {expanded && (
                <div className="grid grid-cols-2 divide-x divide-slate-200 dark:divide-slate-700">
                    <div className="p-3">
                        <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-2 font-medium">
                            Original
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed whitespace-pre-wrap font-mono bg-red-50 dark:bg-red-900/10 rounded p-2 line-through decoration-red-300">
                            {original}
                        </p>
                    </div>
                    <div className="p-3">
                        <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-2 font-medium">
                            AI rewrite
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed whitespace-pre-wrap font-mono bg-emerald-50 dark:bg-emerald-900/10 rounded p-2">
                            {updated}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}