// HTTP-Route-Definition — feature-deklarierte HTTP-Endpoints außerhalb
// der /api/write|query|batch-Pipeline. Use-Case: RSS/Atom-Feeds, OpenAPI-
// Specs, OG-Image-Generators, Webhook-Receiver — alles wo der Feature-
// Author das Wire-Format selbst kontrolliert.
//
// Pattern symmetrisch zu r.queryHandler / r.writeHandler: Definition als
// Teil des Features (nicht des App-Bootstrapping). Phase-3 Multi-Tenant
// wird trivial weil tenant-context via host-resolution greift.
//
// Escape-hatch bleibt: runProdApp.extraRoutes für hand-rolled Routes die
// nichts mit einem Feature zu tun haben (z.B. plattform-spezifische
// Static-Serving-Logic).

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
  /** Wenn true, bypasses die /api/*-Auth-Middleware. Default false —
   *  Routes liegen außerhalb /api/* und sehen die Auth-Middleware
   *  ohnehin nicht; das Flag ist semantisch (= "diese Route ist
   *  bewusst öffentlich") für Boot-Validator + Doku. */
  readonly anonymous?: boolean;
  /** Hono-Handler. Bekommt Hono-Context + Framework-Deps; returnt
   *  Response (sync oder async). */
  readonly handler: HttpRouteHandler;
};
