export function ReplyListSkeleton() {
    return (
        <div className="space-y-px">
            {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3 px-4 py-3.5 border-b border-[var(--border)]">
                    <div className="w-8 h-8 rounded-full bg-[var(--surface-2)] animate-pulse flex-shrink-0 mt-0.5" />
                    <div className="flex-1 space-y-2">
                        <div className="h-3 w-32 rounded bg-[var(--surface-2)] animate-pulse" />
                        <div className="h-2.5 w-20 rounded bg-[var(--surface-2)] animate-pulse" />
                        <div className="h-2.5 w-48 rounded bg-[var(--surface-2)] animate-pulse" />
                    </div>
                </div>
            ))}
        </div>
    );
}