"use client";

interface DiffViewProps {
    from: string;
    to: string;
    label: string;
    compact?: boolean;
}

export function DiffView({ from, to, label, compact }: DiffViewProps) {
    const hasChange = from !== to;

    return (
        <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                {label}
            </p>
            {hasChange ? (
                <div className={`grid gap-2 ${compact ? "" : "sm:grid-cols-2"}`}>
                    <div className="rounded-lg border border-red-500/25 bg-red-500/5 overflow-hidden">
                        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-red-500/15">
                            <span className="text-[10px] font-bold text-red-400 uppercase tracking-widest">
                                Before
                            </span>
                        </div>
                        <p className="px-3 py-2.5 text-sm text-[var(--text-secondary)] leading-relaxed font-mono whitespace-pre-wrap break-words">
                            {from}
                        </p>
                    </div>
                    <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 overflow-hidden">
                        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-emerald-500/15">
                            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">
                                After
                            </span>
                        </div>
                        <p className="px-3 py-2.5 text-sm text-[var(--text-primary)] leading-relaxed font-mono whitespace-pre-wrap break-words">
                            {to}
                        </p>
                    </div>
                </div>
            ) : (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
                    <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-mono whitespace-pre-wrap break-words">
                        {from}
                    </p>
                    <p className="mt-1.5 text-xs text-[var(--text-muted)]">No changes</p>
                </div>
            )}
        </div>
    );
}

interface FullDiffViewProps {
    originalOutput: string;
    modifiedOutput?: string;
    diffVector?: {
        subject?: { from: string; to: string };
        body?: { from: string; to: string };
    } | null;
}

export function FullDiffView({
    originalOutput,
    modifiedOutput,
    diffVector,
}: FullDiffViewProps) {
    if (diffVector?.subject || diffVector?.body) {
        return (
            <div className="space-y-4">
                {diffVector.subject && (
                    <DiffView
                        label="Subject"
                        from={diffVector.subject.from}
                        to={diffVector.subject.to}
                    />
                )}
                {diffVector.body && (
                    <DiffView
                        label="Body"
                        from={diffVector.body.from}
                        to={diffVector.body.to}
                    />
                )}
            </div>
        );
    }

    if (modifiedOutput && modifiedOutput !== originalOutput) {
        return (
            <DiffView
                label="Output"
                from={originalOutput}
                to={modifiedOutput}
            />
        );
    }

    return (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                Original Output
            </p>
            <p className="text-sm text-[var(--text-secondary)] font-mono whitespace-pre-wrap break-words leading-relaxed">
                {originalOutput}
            </p>
        </div>
    );
}