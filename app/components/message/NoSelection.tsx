export function NoSelection() {
    return (
        <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center">
                <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-slate-400"
                >
                    <path d="M15 15l-2 5L9 9l11 4-5 2z" />
                    <path d="M9.5 9.5l5 5" />
                </svg>
            </div>
            <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">
                    Select a message
                </p>
                <p className="text-xs text-slate-400 max-w-[180px]">
                    Choose a message from the list to review it
                </p>
            </div>
        </div>
    );
}