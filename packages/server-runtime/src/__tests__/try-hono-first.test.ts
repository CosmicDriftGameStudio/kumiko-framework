// Pure-function pin for tryHonoFirst. Trivial but load-bearing: drift
// between dev (createKumikoServer) and prod (runProdApp) has already
// caused a bug before (legal-pages worked in prod but not in dev). Both
// now use this helper — if the semantics change (e.g. "matched" treating
// other 4xx differently than 404), both paths MUST update in sync.
//
// kumiko-framework#2435: "matched" used to depend ONLY on the status code
// (404 = no match) — that masked any matched route's deliberate 404 as the
// SPA shell with status 200. The contract now: a router-miss is ONLY a 404
// that ADDITIONALLY carries NO_ROUTE_MATCH_HEADER_NAME (set by buildServer's
// app.notFound(), see framework/api/server.ts). A plain 404 without the
// marker counts as matched — the route answered deliberately.

import { describe, expect, test } from "bun:test";
import { NO_ROUTE_MATCH_HEADER_NAME } from "@cosmicdrift/kumiko-framework/api";
import { type HonoLikeApp, stripNoRouteMatchHeader, tryHonoFirst } from "../try-hono-first";

function makeApp(response: Response): HonoLikeApp {
  return { fetch: () => response };
}

function makeAsyncApp(response: Response): HonoLikeApp {
  return { fetch: async () => response };
}

function routerMissResponse(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: { [NO_ROUTE_MATCH_HEADER_NAME]: "1" },
  });
}

describe("tryHonoFirst", () => {
  test("matched=true on 200 (a Hono route handled it)", async () => {
    const app = makeApp(new Response("ok", { status: 200 }));
    const res = await tryHonoFirst(app, new Request("http://test/foo"));
    expect(res.matched).toBe(true);
    expect(res.response.status).toBe(200);
  });

  test("matched=false on a router-miss (404 + NO_ROUTE_MATCH_HEADER_NAME — caller falls back to the SPA)", async () => {
    const app = makeApp(routerMissResponse());
    const res = await tryHonoFirst(app, new Request("http://test/unknown"));
    expect(res.matched).toBe(false);
    // response is still returned — caller can use the 404 as a last-resort
    // safety net if the SPA fallback doesn't deliver anything either.
    expect(res.response.status).toBe(404);
  });

  test("matched=true for a matched route that deliberately answers 404 (no marker — bug #2435)", async () => {
    // The actual bug: file-derivatives' public-variant route matches and
    // answers `c.text("not found", 404)` for default-deny — NOT a
    // router-miss. Without the marker header this used to be
    // misinterpreted as "no match" and the caller would have served the
    // SPA shell with status 200 instead of passing the real 404 through.
    const app = makeApp(new Response("not found", { status: 404 }));
    const res = await tryHonoFirst(app, new Request("http://test/files/x/thumb"));
    expect(res.matched).toBe(true);
    expect(res.response.status).toBe(404);
  });

  test("matched=true on 401/403/500 (Hono answered — no SPA fallback)", async () => {
    // Bug pin: matched may ONLY be false on a router-miss. When Hono
    // returns 401 (auth required), the route was clearly found and
    // deliberately rejected — an SPA fallback would override that and
    // redirect the user into the SPA instead of showing the 401 message.
    for (const status of [401, 403, 422, 500] as const) {
      const app = makeApp(new Response(null, { status }));
      const res = await tryHonoFirst(app, new Request("http://test/x"));
      expect(res.matched, `status ${status} should be matched`).toBe(true);
    }
  });

  test("accepts both sync and async fetch (Hono variation)", async () => {
    // Hono.app.fetch returns Response | Promise<Response> depending on the
    // handler mix. createApiEntrypoint's apiHandler does the same. The
    // helper must accept both.
    const sync = await tryHonoFirst(
      makeApp(new Response("s", { status: 200 })),
      new Request("http://t/"),
    );
    const asyncRes = await tryHonoFirst(
      makeAsyncApp(new Response("a", { status: 200 })),
      new Request("http://t/"),
    );
    expect(sync.matched).toBe(true);
    expect(asyncRes.matched).toBe(true);
  });

  test("strips NO_ROUTE_MATCH_HEADER_NAME from the returned response (never leaks to the client)", async () => {
    const app = makeApp(routerMissResponse());
    const res = await tryHonoFirst(app, new Request("http://test/unknown"));
    expect(res.response.headers.has(NO_ROUTE_MATCH_HEADER_NAME)).toBe(false);
  });
});

describe("stripNoRouteMatchHeader", () => {
  test("removes the header when present", () => {
    const res = stripNoRouteMatchHeader(routerMissResponse());
    expect(res.headers.has(NO_ROUTE_MATCH_HEADER_NAME)).toBe(false);
  });

  test("is a no-op when the header is absent", () => {
    const res = stripNoRouteMatchHeader(new Response("ok", { status: 200 }));
    expect(res.status).toBe(200);
    expect(res.headers.has(NO_ROUTE_MATCH_HEADER_NAME)).toBe(false);
  });
});
