interface RepliesErrorStateProps {
    message: string;
    onRetry: () => void;
}

export function RepliesErrorState({ message, onRetry }: RepliesErrorStateProps) {
    return (
        <div className="flex flex-col items-center justify-center h-full py-16 px-6 text-center">
            <div className="w-12 h-12 rounded-xl bg-red-400/10 border border-red-400/20 flex items-center justify-center mb-4">
                <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-red-400"
                    aria-hidden="true"
                >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
            </div>
            <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">Failed to load replies</p>
            <p className="text-xs text-[var(--text-muted)] mb-4">{message}</p>
            <button
                onClick={onRetry}
                className="text-xs font-medium text-[var(--red)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] rounded"
            >
                Try again
            </button>
        </div>
    );
}