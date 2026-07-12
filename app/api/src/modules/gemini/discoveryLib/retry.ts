import { circuitBreakerAllow, circuitBreakerFailure, circuitBreakerSuccess } from "./circuit.breaker";
import { RETRY_MAX_ATTEMPTS, RETRY_BASE_DELAY_MS } from "./discovery.constants";

export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    circuitName?: string,
): Promise<T> {
    if (circuitName && !(await circuitBreakerAllow(circuitName))) {
        throw new Error(`Circuit breaker open for ${circuitName}`);
    }

    let lastErr: unknown;

    for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
        if (attempt > 0) {
            await new Promise(r => setTimeout(r, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)));
        }
        try {
            const result = await fn();
            if (circuitName) await circuitBreakerSuccess(circuitName);
            return result;
        } catch (err) {
            lastErr = err;
        }
    }

    if (circuitName) await circuitBreakerFailure(circuitName);
    throw lastErr;
}