import type { Context, Next } from "hono";
import { requestContext } from "./request-context";

const REQUEST_ID_HEADER = "X-Request-ID";
const CORRELATION_ID_HEADER = "X-Correlation-ID";

/**
 * Assigns a requestId + correlationId to every request and wraps execution
 * in AsyncLocalStorage. Runs BEFORE auth — both ids are available even for
 * 401 responses.
 *
 * correlationId defaults to the requestId if the client didn't set
 * `x-correlation-id` — clients that don't care about cross-service tracing
 * still get sensible single-request correlation for free.
 */
export function requestIdMiddleware() {
  return async (c: Context, next: Next) => {
    const requestId = c.req.header(REQUEST_ID_HEADER) ?? requestContext.generateId();
    const correlationId = c.req.header(CORRELATION_ID_HEADER) ?? requestId;
    c.header(REQUEST_ID_HEADER, requestId);
    c.header(CORRELATION_ID_HEADER, correlationId);
    c.set("requestId", requestId);

    // Hono exposes the underlying Fetch Request — its `signal` aborts
    // when the client disconnects (mobile back-press, tab close). We
    // propagate it through requestContext so framework internals can
    // honour cancellation at long-running checkpoints. Older Hono /
    // adapter combos may not populate `c.req.raw.signal`; conditional
    // spread keeps `signal: undefined` out of the stored record so
    // downstream `signal?` checks behave as if no signal exists.
    const signal = c.req.raw?.signal;
    // Client IP for per-IP rate limiting. Trust `x-forwarded-for` when
    // present (proxy/CDN) — first hop is the originating client. Adapter-
    // specific socket-address fallback (bun, node) is not standardized
    // in Hono; deployments behind a proxy should always set xff. Without
    // either we leave `ip` undefined and skip ip-bucketed checks rather
    // than fabricate one.
    const xff = c.req.header("x-forwarded-for");
    const ip = xff?.split(",")[0]?.trim();
    await requestContext.run(
      {
        requestId,
        correlationId,
        ...(signal ? { signal } : {}),
        ...(ip && ip.length > 0 ? { ip } : {}),
      },
      () => next(),
    );
  };
}
