import type { Context, Next } from "hono";
import {
  emitHttpRequest,
  type Meter,
  observabilityContext,
  redactQueryString,
  type SensitiveFilterConfig,
  type Tracer,
} from "../observability";
import { requestContext } from "./request-context";
import { getUser } from "./auth-middleware";

// Wraps each incoming /api/* request in an `http.request` span. Must be
// installed AFTER requestIdMiddleware so the active request-id is available
// as a span attribute. Installed BEFORE auth so auth verification shows up
// as a child span later when auth-middleware itself is instrumented (v2).

export type ObservabilityMiddlewareOptions = {
  readonly tracer: Tracer;
  readonly meter: Meter;
  readonly sensitiveConfig: SensitiveFilterConfig;
};

export function observabilityMiddleware(opts: ObservabilityMiddlewareOptions) {
  const { tracer, meter, sensitiveConfig } = opts;

  return async (c: Context, next: Next) => {
    const method = c.req.method;
    const path = c.req.path;
    const target = redactQueryString(
      c.req.url.replace(/^https?:\/\/[^/]+/, ""),
      sensitiveConfig,
    );

    // Start the root span for this request. kind=server marks it as an
    // incoming server-side span in OTel terms.
    const span = tracer.startSpan("http.request", {
      kind: "server",
      attributes: {
        "http.method": method,
        "http.route": path,
        "http.target": target,
      },
    });

    const reqCtx = requestContext.get();
    if (reqCtx?.requestId) {
      span.setAttribute("kumiko.request_id", reqCtx.requestId);
    }

    const startTime = performance.now();
    try {
      await observabilityContext.run({ activeSpan: span }, () => next());

      // Auth middleware runs inside `next()` and sets the user on the
      // Hono context if the token was valid. Enrich the span after the
      // fact so public paths (health, login) don't emit empty user attrs.
      try {
        const user = getUser(c);
        if (user) {
          span.setAttribute("kumiko.user_id", user.id);
          span.setAttribute("kumiko.tenant_id", user.tenantId);
        }
      } catch {
        // getUser throws if called before auth ran — public paths, fine.
      }

      span.setAttribute("http.status_code", c.res.status);
      if (c.res.status >= 500) {
        span.setStatus("error", `HTTP ${c.res.status}`);
      } else {
        span.setStatus("ok");
      }
    } catch (error) {
      if (error instanceof Error) {
        span.recordException(error);
        span.setStatus("error", error.message);
      } else {
        span.setStatus("error", String(error));
      }
      span.setAttribute("http.status_code", 500);
      throw error;
    } finally {
      const durationSec = (performance.now() - startTime) / 1000;
      // c.res may be undefined on very early throws (before any route handler);
      // fall back to 500 for the metric so the counter is always incremented.
      const status = c.res?.status ?? 500;
      emitHttpRequest(meter, { route: path, method, status }, durationSec);
      span.end();
    }
  };
}
