import { Request, Response, NextFunction } from "express";
import {
  trace,
  context,
  Span,
  SpanStatusCode,
  SpanKind,
} from "@opentelemetry/api";
import crypto from "crypto";
import { httpRequestCounter, httpRequestDurationHistogram } from "./metrics.service";

export const tracer = trace.getTracer("scoutsend-api-tracer", "1.0.0");

export function tracingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId =
    (req.headers["x-correlation-id"] as string) ||
    (req.headers["x-request-id"] as string) ||
    crypto.randomUUID();

  res.setHeader("X-Correlation-ID", correlationId);

  const routePath = req.route?.path || req.path || "unknown_route";
  const spanName = `HTTP ${req.method} ${routePath}`;

  const startTime = Date.now();

  const span = tracer.startSpan(spanName, {
    kind: SpanKind.SERVER,
    attributes: {
      "http.method": req.method,
      "http.target": req.originalUrl || req.url,
      "http.route": routePath,
      "correlation.id": correlationId,
    },
  });

  context.with(trace.setSpan(context.active(), span), () => {
    res.on("finish", () => {
      const durationSec = (Date.now() - startTime) / 1000;
      const statusCode = res.statusCode;

      span.setAttribute("http.status_code", statusCode);

      const user = (req as any).user;
      if (user) {
        if (user.userId) span.setAttribute("user.id", user.userId);
        if (user.orgId) span.setAttribute("org.id", user.orgId);
      }

      if (statusCode >= 500) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${statusCode}` });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }

      span.end();

      // Record Prometheus Metrics
      httpRequestCounter.inc({
        method: req.method,
        route: routePath,
        status_code: String(statusCode),
      });

      httpRequestDurationHistogram.observe(
        {
          method: req.method,
          route: routePath,
          status_code: String(statusCode),
        },
        durationSec
      );
    });

    next();
  });
}

/**
 * Traces an internal asynchronous operation with an OpenTelemetry Span.
 */
export async function traceSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>
): Promise<T> {
  const span = tracer.startSpan(name, {
    kind: SpanKind.INTERNAL,
    attributes,
  });

  return context.with(trace.setSpan(context.active(), span), async () => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}
