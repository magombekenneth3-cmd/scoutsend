"use client";

import {
    useState,
    useEffect,
    useCallback,
    useTransition,
    useRef,
} from "react";
import {
    learningApi,
    type LearningEvent,
    type LearningEventDetail,
    type LearningEventStats,
    type LearningEventsResponse,
    type GetLearningEventsParams,
    type LearningEventType,
    type LearningOutcome,
} from "./learningApi"

export type { LearningEventType, LearningOutcome };

export function useLearningStats() {
    const [data, setData] = useState<LearningEventStats | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const stats = await learningApi.getStats();
            setData(stats);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load stats");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    return { data, error, loading, refetch: load };
}

export function useLearningEvents(initialParams: GetLearningEventsParams = {}) {
    const [params, setParams] = useState<GetLearningEventsParams>({
        page: 1,
        limit: 20,
        ...initialParams,
    });
    const [data, setData] = useState<LearningEventsResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const abortRef = useRef<AbortController | null>(null);

    const load = useCallback(async (p: GetLearningEventsParams) => {
        if (abortRef.current) abortRef.current.abort();
        abortRef.current = new AbortController();
        setLoading(true);
        setError(null);
        try {
            const result = await learningApi.getEvents(p);
            setData(result);
        } catch (e) {
            if ((e as Error).name !== "AbortError") {
                setError(e instanceof Error ? e.message : "Failed to load events");
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(params); }, [load, params]);

    const updateParams = useCallback((updates: Partial<GetLearningEventsParams>) => {
        setParams((prev) => ({ ...prev, ...updates, page: 1 }));
    }, []);

    const setPage = useCallback((page: number) => {
        setParams((prev) => ({ ...prev, page }));
    }, []);

    return { data, error, loading, params, updateParams, setPage, refetch: () => load(params) };
}

export function useLearningEventDetail(id: string | null) {
    const [data, setData] = useState<LearningEventDetail | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const load = useCallback(async (eventId: string) => {
        setLoading(true);
        setError(null);
        try {
            const result = await learningApi.getEventById(eventId);
            setData(result);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load event");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (id) load(id);
        else setData(null);
    }, [id, load]);

    return { data, error, loading, refetch: id ? () => load(id) : undefined };
}

export function useLearningActions(onSuccess?: () => void) {
    const [isPending, startTransition] = useTransition();
    const [actionError, setActionError] = useState<string | null>(null);
    const [actionSuccess, setActionSuccess] = useState<string | null>(null);

    const clearFeedback = useCallback(() => {
        setActionError(null);
        setActionSuccess(null);
    }, []);

    const resolve = useCallback(
        (
            id: string,
            data: { subject?: string; body?: string; reviewerNote?: string }
        ) => {
            clearFeedback();
            startTransition(async () => {
                try {
                    await learningApi.resolve(id, data);
                    setActionSuccess("Event resolved — message approved and queued.");
                    onSuccess?.();
                } catch (e) {
                    setActionError(e instanceof Error ? e.message : "Resolve failed");
                }
            });
        },
        [clearFeedback, onSuccess]
    );

    const dismiss = useCallback(
        (id: string, reason: string) => {
            clearFeedback();
            startTransition(async () => {
                try {
                    await learningApi.dismiss(id, { reason });
                    setActionSuccess("Event dismissed — message rejected.");
                    onSuccess?.();
                } catch (e) {
                    setActionError(e instanceof Error ? e.message : "Dismiss failed");
                }
            });
        },
        [clearFeedback, onSuccess]
    );

    return { resolve, dismiss, isPending, actionError, actionSuccess, clearFeedback };
}