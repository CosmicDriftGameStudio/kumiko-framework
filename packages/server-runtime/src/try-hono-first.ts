// Shared helper for the "Hono-first, SPA-fallback on 404" strategy. Used by
// both dev (createKumikoServer.handleFetch) AND prod (runProdApp's fetch
// handler) — identical semantics, one helper. Without the shared helper the
// two paths drifted silently before (the same bug class that shadowed
// legal-pages in the dev server — runProdApp's docs said "Hono matches
// BEFORE fallback", the dev server didn't).
//
// Pattern:
//   1. Try app.fetch(req) — if Hono matches a route, it wins.
//   2. Router-miss (404 WITH NO_ROUTE_MATCH_HEADER_NAME) → matched=false,
//      caller does the SPA fallback.
//   3. Any other status (200, 401, 500, ...) OR a matched route's own 404
//      WITHOUT the marker → response passes through as-is.
//
// The status code alone used to be the only signal ("404 = no match") —
// that masked any matched route's deliberate 404 (e.g. default-deny reads)
// as the SPA shell with status 200 (kumiko-framework#2435). buildServer
// (framework/api/server.ts) registers app.notFound() LAST on the app object
// and marks exactly the "no handler found" case with
// NO_ROUTE_MATCH_HEADER_NAME — a handler that builds its own
// `c.text(..., 404)` never routes through this code path. The marker is
// process-internal only: stripNoRouteMatchHeader removes it from EVERY
// response before it leaves the process, otherwise a caller could
// distinguish "unknown path" from "known path, access denied" via the
// header's presence — exactly what routes like file-derivatives'
// public-variant deliberately hide behind a single status code.
//
// req.clone() because downstream needs to read the request body again
// (future-proofing for POST/PUT/PATCH — only GET routes today).

import { NO_ROUTE_MATCH_HEADER_NAME } from "@cosmicdrift/kumiko-framework/api";

export type HonoLikeApp = {
  // Hono.app.fetch is `(req) => Response | Promise<Response>` (sync if all
  // handlers are sync, otherwise a Promise). createApiEntrypoint's
  // apiHandler matches the same shape. The union accepts both — we await
  // below, which works for either case.
  readonly fetch: (req: Request) => Response | Promise<Response>;
};

export type HonoFirstResult = {
  /** True when Hono has a matching route (no router-miss).
   *  Caller returns the response directly.
   *  False when no route matches (router-miss, detected via 404 +
   *  NO_ROUTE_MATCH_HEADER_NAME). Caller does the SPA/static fallback;
   *  the response still carries the 404 as a final fallback in case the
   *  SPA path doesn't deliver anything either. */
  readonly matched: boolean;
  readonly response: Response;
};

// Removes the internal router-miss marker from a response before it leaves
// the process. Needed at EVERY site that potentially passes app.fetch()'s
// response through to a real client — including the passthrough paths that
// never call tryHonoFirst at all (e.g. /api/* in runProdApp, dotted-paths/
// non-GET in the dev server). No no-op check needed: Headers.delete() on a
// missing key is harmless.
export function stripNoRouteMatchHeader(response: Response): Response {
  response.headers.delete(NO_ROUTE_MATCH_HEADER_NAME);
  return response;
}

/**
 * Hono-first try: app.fetch FIRST. If matched (no router-miss), the caller
 * returns the response directly. If not matched, the caller falls back to
 * its own SPA/static fallback — the response (404) stays available as a
 * last-resort safety net.
 *
 * req.clone() because downstream needs to read the request body again
 * (future-proofing for POST/PUT/PATCH — only GET routes today).
 */
export async function tryHonoFirst(app: HonoLikeApp, req: Request): Promise<HonoFirstResult> {
  const response = await app.fetch(req.clone());
  const isRouterMiss = response.status === 404 && response.headers.has(NO_ROUTE_MATCH_HEADER_NAME);
  stripNoRouteMatchHeader(response);
  return { matched: !isRouterMiss, response };
}
