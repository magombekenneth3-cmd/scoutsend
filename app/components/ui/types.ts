export type PipelineStage =
    | "PROSPECT"
    | "ENGAGED"
    | "HOT"
    | "MEETING_BOOKED"
    | "DISQUALIFIED";

export interface Signal {
    id: string;
    type?: string;
    signalType?: string;
    value: string;
    confidence: number;
}

export interface Lead {
    id: string;
    firstName: string | null;
    lastName: string | null;
    companyName: string;
    website: string | null;
    title: string | null;
    qualificationScore: number | null;
    pipelineStage: string | null;
    signals: Signal[];
    createdAt: string;
    lastEnrichedAt: string | null;
    _count: { outreachMessages: number; replies: number };
}

export interface LeadsSummary {
    showing: number;
    total: number;
    highPriority: number;
    avgScore: number | null;
    replied: number;
    replyRate: number;
}
