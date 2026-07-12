import type { Lead } from "./messageHelper";

export function leadName(lead: Lead): string {
    if (lead.firstName || lead.lastName)
        return [lead.firstName, lead.lastName].filter(Boolean).join(" ");
    return lead.companyName;
}

export function leadInitials(lead: Lead): string {
    if (lead.firstName && lead.lastName)
        return `${lead.firstName[0]}${lead.lastName[0]}`.toUpperCase();
    return lead.companyName.slice(0, 2).toUpperCase();
}

export function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}