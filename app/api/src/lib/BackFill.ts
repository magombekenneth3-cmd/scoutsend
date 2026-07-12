import { SignalType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { upsertCompany } from "../lib/company/company.upsert";
import { logger } from "../lib/logger";

const BATCH_SIZE = 100;
const VALID_SIGNAL_TYPES = new Set<string>(Object.values(SignalType));

async function backfillCompanies(): Promise<void> {
    const total = await prisma.lead.count({ where: { companyId: null, deletedAt: null } });
    logger.info({ total }, "[backfill] Leads without companyId");

    let offset = 0;
    let linked = 0;
    let errors = 0;

    while (offset < total) {
        const leads = await prisma.lead.findMany({
            where: { companyId: null, deletedAt: null },
            select: { id: true, companyName: true, website: true, linkedinUrl: true },
            orderBy: { createdAt: "asc" },
            take: BATCH_SIZE,
            skip: offset,
        });

        if (leads.length === 0) break;

        for (const lead of leads) {
            try {
                const companyId = await upsertCompany({
                    name: lead.companyName,
                    website: lead.website,
                    linkedinUrl: lead.linkedinUrl,
                });

                await prisma.lead.update({
                    where: { id: lead.id },
                    data: { companyId },
                });

                linked++;
            } catch (err) {
                logger.warn({ err, leadId: lead.id }, "[backfill] Failed to link lead");
                errors++;
            }
        }

        offset += BATCH_SIZE;
        logger.info(
            { linked, errors, progress: `${Math.min(offset, total)}/${total}` },
            "[backfill] Companies progress",
        );
    }

    logger.info({ linked, errors }, "[backfill] Companies complete");
}

async function backfillSignals(): Promise<void> {
    const leadsWithSignals = await prisma.lead.findMany({
        where: {
            companyId: { not: null },
            signals: { some: {} },
        },
        select: {
            companyId: true,
            signals: true,
        },
    });

    logger.info({ count: leadsWithSignals.length }, "[backfill] Leads with signals to migrate");

    let migrated = 0;
    let skipped = 0;

    for (const lead of leadsWithSignals) {
        if (!lead.companyId) continue;

        for (const signal of lead.signals) {
            if (!VALID_SIGNAL_TYPES.has(signal.signalType)) {
                skipped++;
                continue;
            }

            try {
                await prisma.companySignal.upsert({
                    where: {
                        companyId_signalType_value: {
                            companyId: lead.companyId,
                            signalType: signal.signalType as SignalType,
                            value: signal.value,
                        },
                    },
                    update: {},
                    create: {
                        companyId: lead.companyId,
                        signalType: signal.signalType as SignalType,
                        value: signal.value,
                        confidence: signal.confidence,
                        source: signal.source ?? undefined,
                        explanation: signal.explanation ?? undefined,
                    },
                });
                migrated++;
            } catch {
                skipped++;
            }
        }
    }

    logger.info({ migrated, skipped }, "[backfill] Signals complete");
}

(async () => {
    logger.info("[backfill] Starting");
    try {
        await backfillCompanies();
        await backfillSignals();
        logger.info("[backfill] Done");
    } catch (err) {
        logger.error({ err }, "[backfill] Fatal error");
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
})();