import type { Context, Next } from "hono";
import { requestContext } from "./request-context";

const REQUEST_ID_HEADER = "X-Request-ID";

/**
 * Assigns a requestId to every request and wraps execution in AsyncLocalStorage.
 * Runs BEFORE auth — requestId is available even for 401 responses.
 * tenantId/userId default to 0 here, updated by the dispatcher when user is known.
 */
export function requestIdMiddleware() {
  return async (c: Context, next: Next) => {
    const requestId = c.req.header(REQUEST_ID_HEADER) ?? requestContext.generateId();
    c.header(REQUEST_ID_HEADER, requestId);
    c.set("requestId", requestId);

    await requestContext.run({ requestId, tenantId: 0, userId: 0 }, () => next());
  };
}
