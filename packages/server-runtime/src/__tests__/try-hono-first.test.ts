// Pure-function pin für tryHonoFirst. Trivial aber load-bearing:
// Drift zwischen dev (createKumikoServer) und prod (runProdApp) hat
// schon einen Bug verursacht (legal-pages funktionierten in prod aber
// nicht in dev). Beide nutzen jetzt diesen helper — wenn die Semantik
// sich ändert (z.B. "matched" auch für 4xx anders als 404), MÜSSEN
// beide Pfade synchron updaten.

import { describe, expect, test } from "bun:test";
import { type HonoLikeApp, tryHonoFirst } from "../try-hono-first";

function makeApp(response: Response): HonoLikeApp {
  return { fetch: () => response };
}

function makeAsyncApp(response: Response): HonoLikeApp {
  return { fetch: async () => response };
}

describe("tryHonoFirst", () => {
  test("matched=true bei 200 (Hono-route greift)", async () => {
    const app = makeApp(new Response("ok", { status: 200 }));
    const res = await tryHonoFirst(app, new Request("http://test/foo"));
    expect(res.matched).toBe(true);
    expect(res.response.status).toBe(200);
  });

  test("matched=false bei 404 (keine Route — caller fällt auf SPA-fallback)", async () => {
    const app = makeApp(new Response("not found", { status: 404 }));
    const res = await tryHonoFirst(app, new Request("http://test/unknown"));
    expect(res.matched).toBe(false);
    // response wird trotzdem zurückgegeben — caller kann den 404 als
    // letztes Sicherheitsnetz nutzen wenn auch SPA-fallback nichts liefert.
    expect(res.response.status).toBe(404);
  });

  test("matched=true bei 401/403/500 (Hono hat geantwortet — kein SPA-fallback)", async () => {
    // Bug-Pin: matched darf NUR bei status=404 false sein. Wenn Hono
    // 401 (auth required) returnt, war die Route klar gefunden + hat
    // bewusst rejected — SPA-fallback würde das überschreiben und den
    // User auf eine SPA leiten statt die 401-message zu zeigen.
    for (const status of [401, 403, 422, 500] as const) {
      const app = makeApp(new Response(null, { status }));
      const res = await tryHonoFirst(app, new Request("http://test/x"));
      expect(res.matched, `status ${status} should be matched`).toBe(true);
    }
  });

  test("akzeptiert sowohl sync als auch async fetch (Hono-Variation)", async () => {
    // Hono.app.fetch returnt Response | Promise<Response> abhängig vom
    // handler-mix. createApiEntrypoint's apiHandler dasselbe. Helper
    // muss beide schluckable.
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
});
