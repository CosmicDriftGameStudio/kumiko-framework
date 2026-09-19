import type { Context, Next } from "hono";
import { resolveHeaderLocale } from "../i18n/request-locale";
import { LOCALE_HEADER_NAME } from "./api-constants";
import { type RequestContextData, requestContext } from "./request-context";

const REQUEST_ID_HEADER = "X-Request-ID";
const CORRELATION_ID_HEADER = "X-Correlation-ID";

// requestId/correlationId flow unvalidated into append-only event-store
// metadata (e.g. sessions:revoke-all-for-user) — cap shape at the trust
// boundary so a client can't smuggle an oversized/control-char payload into
// permanent, replayed, DSGVO-exported storage via a client-set header.
const SAFE_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

function sanitizeClientId(value: string | undefined): string | undefined {
  return value !== undefined && SAFE_ID_RE.test(value) ? value : undefined;
}

// Request.headers.get() returns `string | null` (Fetch API); Hono's
// c.req.header() normalizes that to `string | undefined`. Match Hono's
// contract here so both builders return the exact same RequestContextData
// shape regardless of which one a call-site uses.
function header(req: Request, name: string): string | undefined {
  return req.headers.get(name) ?? undefined;
}

/**
 * Builds the RequestContextData record for a raw Fetch Request — requestId
 * (client-supplied + sanitized, or generated), correlationId (mirrors
 * requestId unless the client set its own), the underlying abort signal,
 * and the client IP/User-Agent. Extracted out of `buildRequestContextData`
 * so call-sites that only have a `Request` (no Hono `Context`) — e.g.
 * server-runtime's static-fallback page-head resolver, which runs outside
 * Hono's router entirely — can still populate the same AsyncLocalStorage
 * record via `requestContext.run(...)`.
 */
export function buildRequestContextDataFromRequest(req: Request): RequestContextData {
  const requestId = sanitizeClientId(header(req, REQUEST_ID_HEADER)) ?? requestContext.generateId();
  const correlationId = sanitizeClientId(header(req, CORRELATION_ID_HEADER)) ?? requestId;

  // The Fetch Request's `signal` aborts when the client disconnects (mobile
  // back-press, tab close). We propagate it through requestContext so
  // framework internals can honour cancellation at long-running checkpoints.
  const signal = req.signal;
  // Client IP for per-IP rate limiting. Trust `x-forwarded-for` when
  // present (proxy/CDN) — first hop is the originating client. Adapter-
  // specific socket-address fallback (bun, node) is not standardized
  // in Hono; deployments behind a proxy should always set xff. Without
  // either we leave `ip` undefined and skip ip-bucketed checks rather
  // than fabricate one.
  const xff = header(req, "x-forwarded-for");
  const ip = xff?.split(",")[0]?.trim();
  const userAgent = header(req, "user-agent");
  // Runs before auth-middleware, so this reaches public routes too (e.g.
  // signup-request) — that's the whole point: the active UI locale must
  // survive to anonymous callers, not just authenticated ones.
  const locale = resolveHeaderLocale({
    headerLocale: header(req, LOCALE_HEADER_NAME),
    acceptLanguage: header(req, "accept-language"),
  });

  return {
    requestId,
    correlationId,
    startedAt: performance.now(),
    ...(signal ? { signal } : {}),
    ...(ip && ip.length > 0 ? { ip } : {}),
    ...(userAgent !== undefined ? { userAgent } : {}),
    ...(locale !== undefined ? { locale } : {}),
  };
}

/**
 * Builds the RequestContextData record for a Hono request. Thin wrapper
 * around `buildRequestContextDataFromRequest(c.req.raw)` — kept as its own
 * export because most call-sites (server.ts's httpRoute→systemQuery mount,
 * `requestIdMiddleware` below) already hold a Hono `Context`.
 */
export function buildRequestContextData(c: Context): RequestContextData {
  // Older Hono / adapter combos may leave c.req.raw unset even though it's
  // typed as Request — degrade to a bare id pair (no signal/ip/ua/locale)
  // instead of letting req.headers.get() throw on every request.
  if (!c.req.raw) {
    const requestId = requestContext.generateId();
    return { requestId, correlationId: requestId, startedAt: performance.now() };
  }
  return buildRequestContextDataFromRequest(c.req.raw);
}

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
    const data = buildRequestContextData(c);
    c.header(REQUEST_ID_HEADER, data.requestId);
    c.header(CORRELATION_ID_HEADER, data.correlationId);
    c.set("requestId", data.requestId);

    await requestContext.run(data, () => next());
  };
}
