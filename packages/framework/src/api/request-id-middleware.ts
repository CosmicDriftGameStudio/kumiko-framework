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

    await requestContext.run({ requestId, correlationId }, () => next());
  };
}
