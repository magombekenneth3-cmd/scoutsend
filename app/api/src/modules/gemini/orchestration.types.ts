import type { CampaignStatus } from "@prisma/client";

export type { ReviewSummary, RejectionReason } from "./review.agent";

export type ResumePoint = Extract<
    CampaignStatus,
    "RESEARCHING" | "GENERATING" | "REVIEW" | "QUEUED" | "SENDING"
>;
