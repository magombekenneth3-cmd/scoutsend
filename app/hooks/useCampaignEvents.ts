import { useEffect, useRef, useCallback, useState } from "react";

export interface CampaignEvent {
    campaignId: string;
    type: "active" | "progress" | "completed" | "failed";
    jobName: string;
    label: string;
    progress?: number;
    detail?: string;
    timestamp: string;
}

const EVENT_TTL_MS = 30_000;

export function useCampaignEvents(opts?: { onJobComplete?: () => void }) {
    const [events, setEvents] = useState<Map<string, CampaignEvent>>(new Map());
    const sourceRef = useRef<EventSource | null>(null);
    const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onJobCompleteRef = useRef(opts?.onJobComplete);
    onJobCompleteRef.current = opts?.onJobComplete;

    const connect = useCallback(() => {
        if (sourceRef.current) return;

        const es = new EventSource("/api/campaigns/events");
        sourceRef.current = es;

        es.onmessage = (e) => {
            try {
                const event: CampaignEvent = JSON.parse(e.data);
                const key = `${event.campaignId}:${event.jobName}`;

                setEvents((prev) => {
                    const next = new Map(prev);
                    next.set(key, event);
                    return next;
                });

                if (event.type === "completed" || event.type === "failed") {
                    onJobCompleteRef.current?.();

                    setTimeout(() => {
                        setEvents((prev) => {
                            const next = new Map(prev);
                            next.delete(key);
                            return next;
                        });
                    }, EVENT_TTL_MS);
                }
            } catch {}
        };

        es.onerror = () => {
            es.close();
            sourceRef.current = null;
            retryRef.current = setTimeout(connect, 5_000);
        };
    }, []);

    useEffect(() => {
        connect();
        return () => {
            sourceRef.current?.close();
            sourceRef.current = null;
            if (retryRef.current) clearTimeout(retryRef.current);
        };
    }, [connect]);

    const activeEvents = Array.from(events.values()).filter(
        (e) => e.type === "active" || e.type === "progress",
    );

    const recentEvents = Array.from(events.values())
        .filter((e) => e.type === "completed" || e.type === "failed")
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 5);

    return { activeEvents, recentEvents, allEvents: events };
}
