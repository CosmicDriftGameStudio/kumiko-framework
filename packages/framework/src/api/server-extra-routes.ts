import type { Context, Hono } from "hono";
import { ROLES } from "../auth/roles.ts";
import { createSystemUser } from "../engine/system-user.ts";
import type { Registry, WriteResult } from "../engine/types/index.ts";
import { createFallbackLogger } from "../logging/index.ts";
import type { Dispatcher } from "../pipeline/dispatcher.ts";
import { assertUnreachable } from "../utils/index.ts";
import { NON_PUBLIC_API_PATHS, PUBLIC_API_PATHS } from "./api-constants.ts";
import { getUser } from "./auth-middleware.ts";
import { type ClientIpResolver, clientIpSourceFromHonoContext } from "./client-ip.ts";
import {
  type ExtraRouteDefinition,
  ExtraRouteEntries,
  type ExtraRouteEntry,
  ExtraRouteRejection,
  type RoleDispatchArgs,
  type SystemDispatchArgs,
} from "./extra-route.ts";
import { bodyLimitForRoutePath, DEFAULT_MAX_REQUEST_BYTES } from "./route-registrars.ts";
import {
  isMissingOrAnonymousUser,
  makeSystemQuery,
  mountHonoRoute,
  unauthenticatedResponse,
} from "./server-routes.ts";
import type { ServerWiring } from "./server-wiring.ts";

export type PublicApiRequestMatcher = (c: Context) => boolean;

// Only entry:"signature" bypasses jwtGuard (verify() authenticates
// itself); entry:"anonymous" still needs the anonymousAccess fallthrough
// (tenant-by-host), entry:"user" needs c.get("user") populated.
export function compilePublicApiRequestMatcher(
  extraRoutes: readonly ExtraRouteDefinition[] | undefined,
): PublicApiRequestMatcher {
  const matchers = (extraRoutes ?? [])
    .filter((route) => route.entry === ExtraRouteEntries.signature)
    .map((route) => ({ method: route.method, pattern: honoPathToRegex(route.path) }));
  return (c) =>
    PUBLIC_API_PATHS.has(c.req.path) ||
    matchers.some((m) => m.method === c.req.method && m.pattern.test(c.req.path));
}

export function mountExtraRoutes(
  app: Hono,
  wiring: Pick<ServerWiring, "options" | "dispatcher" | "context" | "clientIpResolver">,
): void {
  const { options, dispatcher, context, clientIpResolver } = wiring;
  // extraRoutes — declarative HTTP-routes with a
  // required `entry` tier. Mounted after r.httpRoute: an
  // extraRoute dispatching through `dispatcher` builds Hono's matcher, so
  // this must run before any seed that also dispatches (runProdApp/
  // createKumikoServer call buildServer before seeding).
  if (options.extraRoutes) {
    // Boot-time validation for the whole list BEFORE mounting anything —
    // an app with one bad route should fail loud at boot, not mount N-1
    // routes and then throw on route N.
    for (const route of options.extraRoutes) {
      assertValidExtraRoute(route);
    }
    const dispatchSystemWrite = makeDispatchSystemWrite(dispatcher);
    const dispatchSystemQuery = makeDispatchSystemQuery(dispatcher);
    const dispatchWriteAs = makeDispatchWriteAs(dispatcher);
    for (const route of options.extraRoutes) {
      const honoHandler = buildExtraRouteHonoHandler(route, {
        app,
        dispatcher,
        registry: options.registry,
        secrets: context.secrets,
        dispatchSystemWrite,
        dispatchSystemQuery,
        dispatchWriteAs,
        clientIpResolver,
      });
      mountHonoRoute(
        app,
        route.method,
        route.path,
        honoHandler,
        bodyLimitForRoutePath(route.path, options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES),
      );
    }
  }
}

function assertValidExtraRoute(route: ExtraRouteDefinition): void {
  if (!isKnownExtraRouteEntry(route.entry)) {
    throw new Error(
      `[kumiko] extraRoutes: unknown entry "${String(route.entry)}" on ` +
        `"${route.method} ${route.path}" — expected "anonymous" | "user" | "signature". ` +
        "A JS caller without the ExtraRouteDefinition type can hit this at boot.",
    );
  }
  if (route.entry === ExtraRouteEntries.user && !route.path.startsWith("/api/")) {
    throw new Error(
      `[kumiko] extraRoutes: entry:"user" route "${route.method} ${route.path}" must be ` +
        "mounted under \"/api/\" — that's the only path prefix that rides the framework's " +
        "jwtGuard chain, which is what populates deps.user.",
    );
  }
  // A signature route under /api/ skips jwtGuard/origin/csrf for every
  // path its pattern matches — a wildcard would switch off auth for
  // unrelated /api/* handlers (e.g. "/api/*" swallows /api/write).
  if (
    route.entry === ExtraRouteEntries.signature &&
    route.path.startsWith("/api/") &&
    route.path.includes("*")
  ) {
    throw new Error(
      `[kumiko] extraRoutes: entry:"signature" route "${route.method} ${route.path}" must not ` +
        'use a wildcard under "/api/" — it would bypass the auth chain for every matching path.',
    );
  }
  // A `:param` segment is as broad as a wildcard, and the public matchers test
  // the bare request path: "/:seg/write" and "/api/:hook" both match /api/write.
  if (route.entry === ExtraRouteEntries.signature) {
    const routePattern = honoPathToRegex(route.path);
    const shadowedFrameworkPath = [...PUBLIC_API_PATHS, ...NON_PUBLIC_API_PATHS].find((path) =>
      routePattern.test(path),
    );
    if (shadowedFrameworkPath !== undefined) {
      throw new Error(
        `[kumiko] extraRoutes: entry:"signature" route "${route.method} ${route.path}" must not ` +
          `match the framework path "${shadowedFrameworkPath}" — it would bypass the auth chain for it.`,
      );
    }
  }
}

// SystemAdmin write/query builders shared by mountExtraRoutes
// and server-runtime's `wire` hook (runProdApp/createKumikoServer,
// after buildServer). Privilege-scope: SystemAdmin is the highest
// non-tenant-scoped role — reaches ANY SystemAdmin-gated handler on ANY
// tenant. Only safe for callers that already proved their own authenticity
// (signature verify(), HMAC state, ...), never exposed to a raw request.
export function makeDispatchSystemWrite(
  dispatcher: Dispatcher,
): (args: SystemDispatchArgs) => Promise<WriteResult> {
  return ({ handlerQn, payload, tenantId }) =>
    dispatcher.write(handlerQn, payload, createSystemUser(tenantId, [ROLES.SystemAdmin]));
}

// Privilege-scope: the system user gets exactly the roles the caller names —
// no implicit SystemAdmin — so a seed can write data gated on app roles.
// Same trust requirement as makeDispatchSystemWrite: never expose to a raw
// request, only to code that already proved its own authenticity.
export function makeDispatchWriteAs(
  dispatcher: Dispatcher,
): (args: RoleDispatchArgs) => Promise<WriteResult> {
  return ({ handlerQn, payload, tenantId, roles }) =>
    dispatcher.write(handlerQn, payload, createSystemUser(tenantId, roles));
}

export function makeDispatchSystemQuery(
  dispatcher: Dispatcher,
): (args: SystemDispatchArgs) => Promise<unknown> {
  return ({ handlerQn, payload, tenantId }) =>
    dispatcher.query(handlerQn, payload, createSystemUser(tenantId, [ROLES.SystemAdmin]));
}

// Same dispatcher.write(...) as entry:"user", but the user is getUser(c) —
// see AnonymousExtraRouteDeps.write for the privilege/tenant contract.
function makeAnonymousWrite(
  // biome-ignore lint/suspicious/noExplicitAny: Hono context generics are invisible at the framework boundary
  c: import("hono").Context<any, any>,
  dispatcher: Dispatcher,
): (type: string, payload: unknown) => Promise<WriteResult> {
  return (type, payload) => {
    const user = getUser(c);
    if (!user) {
      throw new Error(
        '[kumiko] extraRoutes: entry:"anonymous" deps.write requires this route to be mounted ' +
          'under "/api/" with anonymousAccess wired — no request-resolved session user was found.',
      );
    }
    return dispatcher.write(type, payload, user);
  };
}

const extraRouteLog = createFallbackLogger("extra-route");

function isKnownExtraRouteEntry(entry: unknown): entry is ExtraRouteEntry {
  return (
    entry === ExtraRouteEntries.anonymous ||
    entry === ExtraRouteEntries.user ||
    entry === ExtraRouteEntries.signature
  );
}

// Hono path pattern ("/api/foo/:bar", "/api/foo/*") → RegExp. Only the
// subset extraRoutes actually uses (static segments, `:param`, trailing
// `*`) — no inline `:param{regex}` constraints, no optional `:param?`.
function honoPathToRegex(path: string): RegExp {
  const segments = path
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) return "[^/]+";
      if (segment === "*") return ".*";
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^${segments}$`);
}

type ExtraRouteHonoHandlerDeps = {
  readonly app: Hono;
  readonly dispatcher: Dispatcher;
  readonly registry: Registry;
  readonly secrets: import("../secrets/index.ts").SecretsContext | undefined;
  readonly dispatchSystemWrite: (args: SystemDispatchArgs) => Promise<WriteResult>;
  readonly dispatchSystemQuery: (args: SystemDispatchArgs) => Promise<unknown>;
  readonly dispatchWriteAs: (args: RoleDispatchArgs) => Promise<WriteResult>;
  readonly clientIpResolver: ClientIpResolver;
};

function buildExtraRouteHonoHandler(
  route: ExtraRouteDefinition,
  shared: ExtraRouteHonoHandlerDeps,
  // biome-ignore lint/suspicious/noExplicitAny: Hono context generics are invisible at the framework boundary
): (c: import("hono").Context<any, any>) => Promise<Response> {
  switch (route.entry) {
    case ExtraRouteEntries.anonymous:
      return async (c) =>
        route.handler(c, {
          app: shared.app,
          registry: shared.registry,
          systemQuery: makeSystemQuery(c, shared.dispatcher, shared.clientIpResolver),
          write: makeAnonymousWrite(c, shared.dispatcher),
          clientIp: shared.clientIpResolver.resolve(clientIpSourceFromHonoContext(c)),
        });
    case ExtraRouteEntries.user:
      return async (c) => {
        const user = getUser(c);
        if (isMissingOrAnonymousUser(user)) {
          return unauthenticatedResponse(c);
        }
        return route.handler(c, {
          app: shared.app,
          registry: shared.registry,
          user,
          query: (type, payload) => shared.dispatcher.query(type, payload, user),
          write: (type, payload) => shared.dispatcher.write(type, payload, user),
        });
      };
    case ExtraRouteEntries.signature:
      return async (c) => {
        const rawBody = await c.req.text();
        const headers: Record<string, string> = {};
        c.req.raw.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value;
        });
        let verified: unknown;
        try {
          verified = await route.verify(
            { rawBody, headers, params: c.req.param(), query: c.req.query() },
            { registry: shared.registry, secrets: shared.secrets },
          );
        } catch (e) {
          if (e instanceof ExtraRouteRejection) {
            if (e.retryAfterSeconds !== undefined) {
              return c.json(e.body, e.status, { "Retry-After": String(e.retryAfterSeconds) });
            }
            return c.json(e.body, e.status);
          }
          // The body goes to unauthenticated callers; infra errors thrown by
          // verify() (secrets, DB) must not leak, so the detail stays in the log.
          extraRouteLog.error(`signature verify() threw on ${c.req.path}`, {
            error: e instanceof Error ? e.message : String(e),
          });
          return c.json(
            {
              error: {
                code: "extra_route_signature_invalid",
                message: "signature verification failed",
              },
            },
            401,
          );
        }
        return route.handler(c, verified, {
          app: shared.app,
          registry: shared.registry,
          secrets: shared.secrets,
          systemQuery: makeSystemQuery(c, shared.dispatcher, shared.clientIpResolver),
          dispatchSystemWrite: shared.dispatchSystemWrite,
          dispatchSystemQuery: shared.dispatchSystemQuery,
          dispatchWriteAs: shared.dispatchWriteAs,
        });
      };
    default:
      return assertUnreachable(route, "extra route entry");
  }
}
