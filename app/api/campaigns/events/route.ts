import { NextRequest } from "next/server";
import { cookies } from "next/headers";

const API_BASE = process.env.INTERNAL_API_URL!;

export const dynamic = "force-dynamic";

function heartbeatStream(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval>;
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(": heartbeat\n\n"));
      interval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(interval);
        }
      }, 25_000);
    },
    cancel() {
      clearInterval(interval);
    },
  });
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

export async function GET(req: NextRequest) {
  const store = await cookies();
  const token = store.get("token")?.value;

  if (!token) {
    return new Response(heartbeatStream(), { status: 200, headers: SSE_HEADERS });
  }

  const encoder = new TextEncoder();
  const abort = new AbortController();

  req.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(": heartbeat\n\n"));

      let upstream: Response;
      try {
        upstream = await fetch(`${API_BASE}/campaigns/events`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "text/event-stream",
            "Cache-Control": "no-cache",
          },
          cache: "no-store",
          signal: abort.signal,
        });
      } catch {
        controller.close();
        return;
      }

      if (!upstream.ok || !upstream.body) {
        controller.close();
        return;
      }

      const reader = upstream.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } catch {
        // client disconnected or upstream closed
      } finally {
        reader.cancel();
        controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}
