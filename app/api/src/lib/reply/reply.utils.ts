export function formatTimeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

export function getInitials(first: string, last: string): string {
    return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
}

export function getAvatarGradient(str: string): string {
    const gradients = [
        "from-rose-500 to-pink-600",
        "from-violet-500 to-purple-600",
        "from-blue-500 to-cyan-600",
        "from-emerald-500 to-teal-600",
        "from-amber-500 to-orange-600",
    ];
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return gradients[Math.abs(hash) % gradients.length];
}

export interface ParsedEmailThread {
    replyText: string;
    quotedChain: string | null;
}

export function parseEmailThread(rawBody: string): ParsedEmailThread {
    if (!rawBody) return { replyText: "", quotedChain: null };

    const quotePatterns: RegExp[] = [
        /\r?\n(?=On\s+[A-Za-z]+,\s+[A-Za-z]+\s+\d+.*wrote:)/i,
        /\r?\n(?=On\s+.*?\s+wrote:)/i,
        /\r?\n(?=-----Original Message-----)/i,
        /\r?\n(?=From:\s+.*?\r?\nSent:\s+)/i,
        /\r?\n(?=From:\s+.*?\r?\nDate:\s+)/i,
        /\r?\n(?=_{5,})/i,
        /\r?\n(?=\s*>)/i,
    ];

    let splitIdx = -1;
    for (const pattern of quotePatterns) {
        const match = rawBody.match(pattern);
        if (match && match.index !== undefined) {
            if (splitIdx === -1 || match.index < splitIdx) {
                splitIdx = match.index;
            }
        }
    }

    if (splitIdx !== -1) {
        const replyText = rawBody.slice(0, splitIdx).trim();
        const quotedChain = rawBody.slice(splitIdx).trim();
        return {
            replyText: replyText || rawBody.trim(),
            quotedChain: quotedChain || null,
        };
    }

    return {
        replyText: rawBody.trim(),
        quotedChain: null,
    };
}