"use client";

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";

export interface CampaignSSEEvent {
    campaignId: string;
    type: "active" | "progress" | "completed" | "failed" | "lead";
    jobName: string;
    label: string;
    progress?: number;
    detail?: string;
    count?: number;
    email?: string;
    leadStatus?: "sending" | "sent" | "failed";
    timestamp: string;
}

type EventListener = (event: CampaignSSEEvent) => void;

interface CampaignEventsContextType {
    subscribe: (listener: EventListener) => () => void;
    lastEvent: CampaignSSEEvent | null;
}

const CampaignEventsContext = createContext<CampaignEventsContextType | null>(null);

const SSE_INITIAL_RETRY_MS = 1_000;
const SSE_MAX_RETRY_MS = 30_000;

const NON_RETRYABLE_STATUSES = new Set([401, 403]);

export function CampaignEventsProvider({
    children,
    enabled = true,
}: {
    children: React.ReactNode;
    enabled?: boolean;
}) {
    const [lastEvent, setLastEvent] = useState<CampaignSSEEvent | null>(null);
    const listenersRef = useRef<Set<EventListener>>(new Set());
    const esRef = useRef<EventSource | null>(null);
    const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const retryDelayRef = useRef(SSE_INITIAL_RETRY_MS);
    const abortedRef = useRef(false);

    const subscribe = useCallback((listener: EventListener) => {
        listenersRef.current.add(listener);
        return () => {
            listenersRef.current.delete(listener);
        };
    }, []);

    const disconnect = useCallback(() => {
        if (retryRef.current) {
            clearTimeout(retryRef.current);
            retryRef.current = null;
        }
        esRef.current?.close();
        esRef.current = null;
    }, []);

    const connect = useCallback(() => {
        if (esRef.current || abortedRef.current || !enabled) return;

        const es = new EventSource("/api/campaigns/events", { withCredentials: true });
        esRef.current = es;

        es.onopen = () => {
            retryDelayRef.current = SSE_INITIAL_RETRY_MS;
        };

        es.onmessage = (e) => {
            try {
                const event: CampaignSSEEvent = JSON.parse(e.data);
                setLastEvent(event);
                listenersRef.current.forEach((fn) => {
                    try { fn(event); } catch { }
                });
            } catch { }
        };

        es.onerror = () => {
            es.close();
            esRef.current = null;

            if (abortedRef.current) return;

            const delay = retryDelayRef.current;
            retryDelayRef.current = Math.min(delay * 2, SSE_MAX_RETRY_MS);
            retryRef.current = setTimeout(connect, delay);
        };
    }, [enabled]);

    useEffect(() => {
        if (!enabled) {
            abortedRef.current = true;
            disconnect();
            return;
        }

        abortedRef.current = false;
        retryDelayRef.current = SSE_INITIAL_RETRY_MS;

        const timer = setTimeout(connect, SSE_INITIAL_RETRY_MS);

        return () => {
            abortedRef.current = true;
            clearTimeout(timer);
            disconnect();
        };
    }, [connect, disconnect, enabled]);

    return (
        <CampaignEventsContext.Provider value={{ subscribe, lastEvent }}>
            {children}
        </CampaignEventsContext.Provider>
    );
}

export function useCampaignEventsContext(): CampaignEventsContextType | null {
    return useContext(CampaignEventsContext);
}
