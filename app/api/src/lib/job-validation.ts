import { ZodError, ZodSchema } from "zod";
import type { Job } from "bullmq";
import { logger } from "./logger";

export class JobValidationError extends Error {
    constructor(jobName: string, zodError: ZodError) {
        const detail = zodError.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; ");
        super(`Invalid payload for job "${jobName}": ${detail}`);
        this.name = "JobValidationError";
    }
}


export function parseJobData<T>(schema: ZodSchema<T>, job: Job): T {
    const result = schema.safeParse(job.data);
    if (!result.success) {
        logger.error(
            { jobId: job.id, jobName: job.name, issues: result.error.issues },
            "[job-validation] Rejected malformed job payload",
        );
        throw new JobValidationError(job.name, result.error);
    }
    return result.data;
}