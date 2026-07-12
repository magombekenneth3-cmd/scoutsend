/**
 * discovery-script.agent.ts
 *
 * SMYKM Discovery Call Script Card Generator
 * ─────────────────────────────────────────────
 * When a lead reaches the MEETING_BOOKED stage, generate a tailored
 * 3-part opening script the rep can read from during the call:
 *
 *   1. Polite context & brevity opener
 *   2. SMYKM hook (a specific observation from research)
 *   3. Breathing room & permission question
 *
 * The card is stored in the lead's enrichmentData under `discoveryScript`
 * and surfaced on the rep dashboard.
 */

import { callGemini, extractJSON, MODELS } from "./gemini.client";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { PipelineStage } from "@prisma/client";

export interface DiscoveryScript {
    /** Rep reads this verbatim to open the call gracefully. */
    politeOpener: string;
    /** The one SMYKM hook — a specific, researched observation. */
    smykmHook: string;
    /** Breathing room question that invites the prospect to speak first. */
    breathingRoomQuestion: string;
    /** The signal type used as the primary SMYKM hook. */
    leadingSignalType: string;
}

function isValidDiscoveryScript(value: unknown): value is DiscoveryScript {
    if (!value || typeof value !== "object") return false;
    const v = value as Record<string, unknown>;
    return (
        typeof v.politeOpener === "string" && v.politeOpener.trim().length > 0 &&
        typeof v.smykmHook === "string" && v.smykmHook.trim().length > 0 &&
        typeof v.breathingRoomQuestion === "string" && v.breathingRoomQuestion.trim().length > 0 &&
        typeof v.leadingSignalType === "string"
    );
}

/**
 * Generate a pre-call discovery script card for a lead.
 *
 * @param leadId  The lead that has just booked a meeting.
 * @returns       The generated DiscoveryScript, or null if generation fails.
 */
export async function generateDiscoveryScript(leadId: string): Promise<DiscoveryScript | null> {
    const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        include: {
            signals: {
                orderBy: { confidence: "desc" },
                take: 10,
            },
            campaign: {
                select: {
                    icpDescription: true,
                    name: true,
                    senderDomain: { select: { domain: true } },
                    senderMailbox: { select: { emailAddress: true } },
                },
            },
            outreachMessages: {
                where: { isFollowUp: false },
                orderBy: { sentAt: "desc" },
                take: 1,
                select: { subject: true, body: true, leadingSignal: true },
            },
        },
    });

    if (!lead) {
        logger.warn({ leadId }, "[discovery-script] Lead not found");
        return null;
    }

    const senderDomain =
        lead.campaign.senderDomain?.domain ??
        lead.campaign.senderMailbox?.emailAddress?.split("@")[1] ??
        "our company";

    // Build signal summary — prioritise Human → Company → Space
    const signalBlock = lead.signals
        .map((s) => `• [${s.signalType}] ${s.value} (confidence: ${s.confidence.toFixed(2)})`)
        .join("\n") || "No signals available";

    const lastEmail = lead.outreachMessages[0];
    const priorContactBlock = lastEmail
        ? `\nThe rep already sent outbound email with subject: "${lastEmail.subject}". ` +
          `The leading signal used was: ${lastEmail.leadingSignal ?? "unknown"}.`
        : "\nNo prior email sent — this is a warm inbound or referral.";

    const { text } = await callGemini({
        agentName: "discovery-script.generator",
        model: MODELS.GENERATE,
        systemPrompt: `You are an expert B2B sales coach writing a pre-call discovery script for a sales rep.

The script follows the SMYKM (Show Me You Know Me) framework and has exactly THREE parts:

PART 1 — POLITE OPENER (2–3 sentences):
Express gratitude for the prospect's time. Briefly introduce what your company does in 1–3 succinct items (not a pitch — think elevator shortlist). Signal that you want to hear from them first.
Example: "Thank you so much for making time for us today. I could tell you a million things about [Company], [1], [2], and [3], but I would love to hear about you first."

PART 2 — SMYKM HOOK (1–2 sentences):
Reference ONE specific, research-backed observation about the prospect or their company. It must be precise — not generic. Use the strongest available signal.
Example: "I know you recently had an acquisition / replaced your CRO / doubled your revenue target — congratulations on that by the way."

PART 3 — BREATHING ROOM & PERMISSION QUESTION (2–3 sentences):
Invite the prospect to share their world without pressure. Ask about their team, challenges, or current landscape. End with "if that's okay."
Example: "Tell me about your team, your challenges, what's the overall landscape like for you if that's okay."

RULES:
- Never pitch features in the script
- Keep each part under 60 words
- Write the rep's actual spoken words — not instructions
- Warm, peer-to-peer tone
- Adapt company mentions to the senderDomain

Return ONLY JSON:
{
  "politeOpener": string,
  "smykmHook": string,
  "breathingRoomQuestion": string,
  "leadingSignalType": string
}`,
        userPrompt: `Campaign: ${lead.campaign.name}
ICP: ${lead.campaign.icpDescription}
Sender domain: ${senderDomain}

Prospect:
- Name: ${lead.firstName ?? "there"} ${lead.lastName ?? ""}
- Title: ${lead.title ?? "professional"}
- Company: ${lead.companyName}
- LinkedIn: ${lead.linkedinUrl ?? "unknown"}
${priorContactBlock}

Available signals (prioritise Human → Company → Space):
${signalBlock}

Generate the 3-part SMYKM discovery call script now.`,
        metadata: { leadId },
        temperature: 0.6,
    });

    const parsed = extractJSON<unknown>(text);

    if (!isValidDiscoveryScript(parsed)) {
        logger.warn({ leadId, raw: text.slice(0, 300) }, "[discovery-script] Invalid LLM output");
        return null;
    }

    // Persist to lead enrichmentData so the dashboard can surface it
    await prisma.lead.update({
        where: { id: leadId },
        data: {
            enrichmentData: {
                ...(typeof lead.enrichmentData === "object" && lead.enrichmentData !== null
                    ? (lead.enrichmentData as Record<string, unknown>)
                    : {}),
                discoveryScript: {
                    ...parsed,
                    generatedAt: new Date().toISOString(),
                },
            },
        },
    });

    logger.info(
        { leadId, leadingSignalType: parsed.leadingSignalType },
        "[discovery-script] Script card generated and stored",
    );

    return parsed;
}

/**
 * Convenience wrapper: generate scripts for all leads in a campaign
 * that have transitioned to MEETING_BOOKED but don't yet have a script card.
 */
export async function generateDiscoveryScriptsForCampaign(campaignId: string): Promise<{
    generated: number;
    skipped: number;
    errored: number;
}> {
    const leads = await prisma.lead.findMany({
        where: {
            campaignId,
            pipelineStage: PipelineStage.MEETING_BOOKED,
        },
        select: { id: true, enrichmentData: true },
    });

    // Filter in code: skip leads that already have a discoveryScript card.
    const leadsNeedingScript = leads.filter((lead) => {
        const ed = typeof lead.enrichmentData === "object" && lead.enrichmentData !== null
            ? (lead.enrichmentData as Record<string, unknown>)
            : {};
        return !ed.discoveryScript;
    });

    let generated = 0;
    let skipped = 0;
    let errored = 0;

    for (const lead of leadsNeedingScript) {
        try {
            const script = await generateDiscoveryScript(lead.id);
            if (script) {
                generated++;
            } else {
                skipped++;
            }
        } catch (err) {
            logger.error({ err, leadId: lead.id }, "[discovery-script] Failed for lead");
            errored++;
        }
    }

    logger.info({ campaignId, generated, skipped, errored }, "[discovery-script] Batch complete");

    return { generated, skipped, errored };
}
