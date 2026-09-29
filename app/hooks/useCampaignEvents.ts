import { useEffect, useRef, useState } from "react";
import { useCampaignEventsContext, CampaignSSEEvent } from "../context/CampaignEventsContext";

export type CampaignEvent = CampaignSSEEvent;

const EVENT_TTL_MS = 30_000;

export function useCampaignEvents(opts?: { onJobComplete?: () => void }) {
    const [events, setEvents] = useState<Map<string, CampaignEvent>>(new Map());
    const eventsCtx = useCampaignEventsContext();
    const onJobCompleteRef = useRef(opts?.onJobComplete);
    onJobCompleteRef.current = opts?.onJobComplete;

    useEffect(() => {
        if (!eventsCtx) return;

        return eventsCtx.subscribe((event) => {
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
        });
    }, [eventsCtx]);

    const activeEvents = Array.from(events.values()).filter(
        (e) => e.type === "active" || e.type === "progress",
    );

    const recentEvents = Array.from(events.values())
        .filter((e) => e.type === "completed" || e.type === "failed")
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 5);

    return { activeEvents, recentEvents, allEvents: events };
}
