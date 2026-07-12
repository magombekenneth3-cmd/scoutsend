"use client";

import Link from "next/link";
import { useId } from "react";
import { CampaignBadge } from "./badges";
import type { CampaignStatus } from "./badges";

export interface Campaign {
    id: string;
    name: string;
    status: CampaignStatus;
    leadsCount: number;
    sentCount: number;
    openRate: number;
    replyRate: number;
    createdAt: string;
}

interface CampaignRowProps {
    campaign: Campaign;
}

function RateBar({ value, color }: { value: number; color: string }) {
    return (
        <div className="flex items-center gap-2">
            <div
                className="w-14 h-1 bg-[var(--surface-2)] rounded-full overflow-hidden"
                role="presentation"
                aria-hidden="true"
            >
                <div
                    className={`h-full ${color} rounded-full`}
                    style={{ width: `${Math.min(value, 100)}%` }}
                />
            </div>
            <span className="text-sm text-[var(--text-secondary)] tabular-nums">
                {value.toFixed(1)}%
            </span>
        </div>
    );
}

function CampaignRow({ campaign }: CampaignRowProps) {
    return (
        <tr className="group border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors duration-100">
            <td className="px-4 py-3 min-w-[160px]">
                <Link
                    href={`/dashboard/campaigns/${campaign.id}`}
                    className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--red)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] rounded"
                >
                    {campaign.name}
                </Link>
            </td>
            <td className="px-4 py-3 whitespace-nowrap">
                <CampaignBadge status={campaign.status} />
            </td>
            <td className="px-4 py-3 text-sm text-[var(--text-secondary)] tabular-nums whitespace-nowrap">
                {campaign.leadsCount.toLocaleString()}
            </td>
            <td className="px-4 py-3 text-sm text-[var(--text-secondary)] tabular-nums whitespace-nowrap">
                {campaign.sentCount.toLocaleString()}
            </td>
            <td className="px-4 py-3 whitespace-nowrap">
                <RateBar value={campaign.openRate} color="bg-sky-400" />
            </td>
            <td className="px-4 py-3 whitespace-nowrap">
                <RateBar value={campaign.replyRate} color="bg-emerald-400" />
            </td>
            <td className="px-4 py-3 text-xs text-[var(--text-muted)] whitespace-nowrap tabular-nums">
                {new Date(campaign.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                })}
            </td>
        </tr>
    );
}

interface CampaignTableProps {
    campaigns: Campaign[];
}

export function CampaignTable({ campaigns }: CampaignTableProps) {
    const captionId = useId();

    return (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-4 border-b border-[var(--border)]">
                <h2
                    id={captionId}
                    className="text-sm font-semibold font-display text-[var(--text-primary)]"
                >
                    Campaigns
                </h2>
                {campaigns.length > 0 && (
                    <span className="text-xs text-[var(--text-muted)] tabular-nums">
                        {campaigns.length} total
                    </span>
                )}
            </div>

            {campaigns.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                    <div className="w-10 h-10 rounded-full bg-[var(--surface-2)] flex items-center justify-center text-[var(--text-muted)]">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                            <rect x="9" y="3" width="6" height="4" rx="1" />
                        </svg>
                    </div>
                    <p className="text-sm text-[var(--text-secondary)]">No campaigns yet</p>
                    <p className="text-xs text-[var(--text-muted)]">
                        Create your first campaign to get started
                    </p>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table
                        className="w-full min-w-[640px]"
                        aria-labelledby={captionId}
                    >
                        <thead>
                            <tr className="border-b border-[var(--border)]">
                                {[
                                    { label: "Name", srOnly: false },
                                    { label: "Status", srOnly: false },
                                    { label: "Leads", srOnly: false },
                                    { label: "Sent", srOnly: false },
                                    { label: "Open Rate", srOnly: false },
                                    { label: "Reply Rate", srOnly: false },
                                    { label: "Created", srOnly: false },
                                ].map(({ label }) => (
                                    <th
                                        key={label}
                                        scope="col"
                                        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]"
                                    >
                                        {label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {campaigns.map((c) => (
                                <CampaignRow key={c.id} campaign={c} />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}