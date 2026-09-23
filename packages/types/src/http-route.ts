// HTTP route definition — feature-declared HTTP endpoints outside
// the /api/write|query|batch pipeline. Use case: RSS/Atom feeds, OpenAPI
// specs, OG image generators, webhook receivers — anything where the
// feature author controls the wire format themselves.
//
// Pattern symmetric to r.queryHandler / r.writeHandler: definition as
// part of the feature (not the app bootstrapping). Phase-3 multi-tenant
// becomes trivial because tenant context is picked up via host resolution.
//
// Escape-hatch stays: runProdApp.extraRoutes (declarative list with
// `entry` tier) for hand-rolled routes that have nothing to do with a
// feature (e.g. platform-specific static-serving logic).

import type { Context } from "hono";

/** Subset von HTTP-Methoden den wir aktiv unterstützen. Hono spricht
 *  alle, aber das hier sind die einzigen die ein Feature-Author
 *  realistisch deklariert. */
export type HttpRouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

/** Dependencies die der Handler vom Framework bekommt. App-Author kann
 *  die App selbst aufrufen (`deps.app.fetch(...)` für intern-call) oder
 *  direkt per dispatcher Daten ziehen. Db/Redis sind die rohen Connections
 *  — wer Tenant-Scope braucht muss durch dispatcher.query gehen.
 *
 *  Hono-typing: `Context<any, any>` weil das Hono-Type-Param-Setup nur
 *  intern relevant ist. Concrete Hono-app wird im Boot-Path zugewiesen. */
export type HttpRouteHandlerDeps = {
  /** Die Hono-app — Handler kann via app.fetch(...) interne Routes
   *  ansprechen (z.B. /api/query mit der vollen Auth-/Anonymous-Chain). */
  // biome-ignore lint/suspicious/noExplicitAny: Hono's generic-Param ist im Framework-Boundary unsichtbar
  readonly app: import("hono").Hono<any, any>;
  /** Run a query handler in-process, forcing a SPECIFIC tenant — WITHOUT
   *  going through the public /api/query HTTP layer (no header parsing, no
   *  anonymousAccess tenant resolution). The synthesized caller carries
   *  anonymous-level access ONLY (same role a real anonymous request would
   *  have, no more) — the primitive forces the tenant, not the privilege
   *  level, so it stays safe to call from any `anonymous: true` route
   *  without risking a field-level disclosure a real anonymous caller
   *  couldn't already get. Use this whenever the route needs a tenant
   *  other than the one the request resolves to (e.g. always
   *  SYSTEM_TENANT_ID regardless of the visited host) — spoofing that via
   *  an internal X-Tenant header on `app.fetch(...)` is indistinguishable
   *  from an external client and gets rejected by resolverTrust:
   *  "authoritative" anonymousAccess configs (see auth-middleware.ts). */
  readonly systemQuery: (
    type: string,
    payload: unknown,
    tenantId: import("./identifiers").TenantId,
  ) => Promise<unknown>;
};

export type HttpRouteHandler = (
  // biome-ignore lint/suspicious/noExplicitAny: Hono Context-Generics sind im Framework-Boundary unsichtbar
  c: Context<any, any>,
  deps: HttpRouteHandlerDeps,
) => Response | Promise<Response>;

export type HttpRouteDefinition = {
  /** HTTP-Methode — bei Hono-Mount via app.{get,post,...}(path). */
  readonly method: HttpRouteMethod;
  /** URL-Pfad (Hono-Pattern, z.B. "/feed.xml" oder "/og/:tenantId.png"). */
  readonly path: string;
  /** true = public, no session required. false = mounted behind the
   *  session auth chain (no anonymous fallthrough, PAT rate limit,
   *  origin + CSRF guards) — a request without a session gets 401. The
   *  handler reads the caller via getUser(c). */
  readonly anonymous: boolean;
  /** Hono-Handler. Bekommt Hono-Context + Framework-Deps; returnt
   *  Response (sync oder async). */
  readonly handler: HttpRouteHandler;
};
