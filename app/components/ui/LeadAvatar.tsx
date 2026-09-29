const AVATAR_PALETTE = [
    "bg-blue-50 text-blue-700",
    "bg-violet-50 text-violet-700",
    "bg-orange-50 text-orange-700",
    "bg-pink-50 text-pink-700",
    "bg-emerald-50 text-emerald-700",
    "bg-slate-100 text-slate-700",
] as const;

function hashString(value: string): number {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
        hash = (hash << 5) - hash + value.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}

interface LeadAvatarProps {
    name: string;
    size?: "sm" | "md";
}

export function LeadAvatar({ name, size = "md" }: LeadAvatarProps) {
    const colorClass = AVATAR_PALETTE[hashString(name) % AVATAR_PALETTE.length];
    const initial = name.trim().charAt(0).toUpperCase() || "?";
    const sizeClass = size === "sm" ? "w-6 h-6 text-[10px]" : "w-7 h-7 text-xs";

    return (
        <span
            className={`inline-flex shrink-0 items-center justify-center rounded-md font-medium select-none ${colorClass} ${sizeClass}`}
            aria-hidden="true"
        >
            {initial}
        </span>
    );
}
