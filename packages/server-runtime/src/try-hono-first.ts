// Shared helper für die "Hono-first, SPA-fallback wenn 404"-Strategie.
// Wird von dev (createKumikoServer.handleFetch) UND prod (runProdApp's
// fetch-handler) verwendet — identische Semantik, ein helper. Ohne den
// shared-Helper drifteten die beiden Pfade silent (genau der Bug der
// legal-pages im dev-server geshadowed hat — runProdApp's docs sagten
// "Hono matched VOR fallback", dev-server tat das NICHT).
//
// Pattern:
//   1. Try app.fetch(req) — wenn Hono eine route matcht, greift sie.
//   2. 404 vom Hono-stack → null returnen, caller macht SPA-fallback.
//   3. Sonstige status (200, 401, 500, ...) → response durchreichen.
//
// req.clone() weil downstream der req body nochmal lesbar sein muss
// (POST/PUT/PATCH future-proof — heute nur GET-routes betroffen).

export type HonoLikeApp = {
  // Hono.app.fetch ist `(req) => Response | Promise<Response>` (sync wenn
  // alle Handler sync sind, sonst Promise). createApiEntrypoint's
  // apiHandler matcht dieselbe shape. Union accepts both — wir await
  // unten, das funktioniert für beide Fälle.
  readonly fetch: (req: Request) => Response | Promise<Response>;
};

export type HonoFirstResult = {
  /** True wenn Hono eine matchende Route hat (status !== 404).
   *  Caller returnt dann response direkt.
   *  False wenn keine Route matcht (status === 404). Caller macht den
   *  SPA-/static-fallback; response enthält den 404 als final-fallback
   *  falls auch der SPA-Pfad nichts liefert. */
  readonly matched: boolean;
  readonly response: Response;
};

/**
 * Hono-first try: app.fetch ZUERST. Wenn matched (status !== 404), gibt
 * der caller den response direkt zurück. Wenn nicht matched, fällt der
 * caller in den eigenen SPA-/static-fallback zurück — der response (404)
 * bleibt verfügbar als letztes Sicherheitsnetz.
 *
 * req.clone() weil downstream der req body nochmal lesbar sein muss
 * (POST/PUT/PATCH future-proof — heute nur GET-routes betroffen).
 */
export async function tryHonoFirst(app: HonoLikeApp, req: Request): Promise<HonoFirstResult> {
  const response = await app.fetch(req.clone());
  return { matched: response.status !== 404, response };
}
