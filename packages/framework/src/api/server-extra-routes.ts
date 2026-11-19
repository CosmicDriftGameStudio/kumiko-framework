import type { ContractQuery, ContractWrite } from "@cosmicdrift/kumiko-types/handler-contract";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import { isValidHttpRouteRateLimit } from "@cosmicdrift/kumiko-types/http-route";
import type {
  RateLimitDecision,
  RateLimitResolver,
} from "@cosmicdrift/kumiko-types/rate-limit-types";
import type { Context, Hono } from "hono";
import { ROLES } from "../auth/roles.ts";
import { createSystemUser } from "../engine/system-user.ts";
import type { Registry, SessionUser } from "../engine/types/index.ts";
import { FILE_DOWNLOAD_LINK_ROUTE_PREFIX } from "../files/file-download-link.ts";

import { createFallbackLogger } from "../logging/index.ts";
import { bindContractQuery, bindContractWrite } from "../pipeline/contract-dispatch.ts";
import type { Dispatcher } from "../pipeline/dispatcher.ts";
import {
  createFailOpenReporter,
  respondRateLimited,
  setRateLimitHeaders,
} from "../rate-limit/middleware.ts";
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
  type SignatureExtraRoute,
  type SystemDispatchArgs,
} from "./extra-route.ts";
import { bodyLimitForRoutePath, DEFAULT_MAX_REQUEST_BYTES } from "./route-registrars.ts";
import {
  buildRouteRateLimitGuards,
  makeSystemQuery,
  mountHonoRoute,
} from "./server-feature-http-routes.ts";
import { isMissingOrAnonymousUser, unauthenticatedResponse } from "./server-routes.ts";
import type { ServerWiring } from "./server-wiring.ts";
import { tenantScopedSecrets } from "./tenant-scoped-secrets.ts";

export type PublicApiRequestMatcher = (c: Context) => boolean;

// The signed token is the permission. Exactly one segment after the prefix, so a deeper path such
// as /files/:id/variant/:name with id "link" keeps its session guard.
function isFileDownloadLinkPath(path: string): boolean {
  return (
    path.startsWith(FILE_DOWNLOAD_LINK_ROUTE_PREFIX) &&
    !path.includes("/", FILE_DOWNLOAD_LINK_ROUTE_PREFIX.length)
  );
}

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
    (c.req.method === "GET" && isFileDownloadLinkPath(c.req.path)) ||
    matchers.some((m) => m.method === c.req.method && m.pattern.test(c.req.path));
}

export function mountExtraRoutes(
  app: Hono,
  wiring: Pick<
    ServerWiring,
    | "options"
    | "dispatcher"
    | "context"
    | "clientIpResolver"
    | "rateLimitResolver"
    | "observability"
  >,
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
    assertSignatureRoutesDoNotOverlapMountedRoutes(app, options.extraRoutes);
    const dispatchSystemWrite = makeDispatchSystemWrite(dispatcher);
    const dispatchSystemQuery = makeDispatchSystemQuery(dispatcher);
    const dispatchWriteAs = makeDispatchWriteAs(dispatcher);
    const verifiedRateLimitFailOpen = createFailOpenReporter(
      "extra-route-verified",
      wiring.observability.meter,
    );
    for (const route of options.extraRoutes) {
      const honoHandler = buildExtraRouteHonoHandler(route, {
        app,
        dispatcher,
        registry: options.registry,
        secrets: context.secrets && tenantScopedSecrets(context.secrets),
        dispatchSystemWrite,
        dispatchSystemQuery,
        dispatchWriteAs,
        clientIpResolver,
        rateLimitResolver: wiring.rateLimitResolver,
        onVerifiedRateLimitFailOpen: verifiedRateLimitFailOpen,
      });
      mountHonoRoute(app, route.method, route.path, honoHandler, [
        ...buildRouteRateLimitGuards(route, wiring),
        ...bodyLimitForRoutePath(route.path, options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES),
      ]);
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
  if (route.rateLimit !== undefined && !isValidHttpRouteRateLimit(route.rateLimit)) {
    throw new Error(
      `[kumiko] extraRoutes: "${route.method} ${route.path}" rateLimit needs positive integer ` +
        "limit and windowSeconds.",
    );
  }
  if (
    route.entry === ExtraRouteEntries.signature &&
    route.verifiedRateLimit !== undefined &&
    !isValidHttpRouteRateLimit(route.verifiedRateLimit)
  ) {
    throw new Error(
      `[kumiko] extraRoutes: "${route.method} ${route.path}" verifiedRateLimit needs positive integer ` +
        "limit and windowSeconds.",
    );
  }
}

// The public matcher lets every request through that a signature route's pattern matches, so a
// signature route must not overlap a /api route that relies on the auth chain: the framework's own
// sub-routes (mounted before extraRoutes, e.g. /api/files/:id) and the non-signature extraRoutes.
function assertSignatureRoutesDoNotOverlapMountedRoutes(
  app: Hono,
  extraRoutes: readonly ExtraRouteDefinition[],
): void {
  const guardedRoutes: readonly { readonly method: string; readonly path: string }[] = [
    ...app.routes.filter((route) => route.method !== "ALL" && route.path.startsWith("/api/")),
    ...extraRoutes.filter((route) => route.entry !== ExtraRouteEntries.signature),
  ];
  for (const signatureRoute of extraRoutes) {
    if (signatureRoute.entry !== ExtraRouteEntries.signature) continue;
    const signatureMethod: string = signatureRoute.method;
    const signaturePattern = honoPathToRegex(signatureRoute.path);
    const overlapped = guardedRoutes.find(
      (route) =>
        route.method === signatureMethod &&
        (signaturePattern.test(route.path) ||
          honoPathToRegex(route.path).test(signatureRoute.path)),
    );
    if (overlapped !== undefined) {
      throw new Error(
        `[kumiko] extraRoutes: entry:"signature" route "${signatureRoute.method} ${signatureRoute.path}" must not ` +
          `overlap the route "${overlapped.method} ${overlapped.path}" — it would bypass the auth chain for it.`,
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

// Same dispatcher calls as entry:"user", but the user is getUser(c) —
// see AnonymousExtraRouteDeps.write/query for the privilege/tenant contract.
function requireRequestSessionUser(c: Context, depName: "write" | "query"): SessionUser {
  const user = getUser(c);
  if (!user) {
    throw new Error(
      `[kumiko] extraRoutes: entry:"anonymous" deps.${depName} requires this route to be mounted ` +
        'under "/api/" with anonymousAccess wired — no request-resolved session user was found.',
    );
  }
  return user;
}

function makeAnonymousWrite(c: Context, dispatcher: Dispatcher): ContractWrite {
  return bindContractWrite((type, payload) =>
    dispatcher.write(type, payload, requireRequestSessionUser(c, "write")),
  );
}

function makeAnonymousQuery(c: Context, dispatcher: Dispatcher): ContractQuery {
  return bindContractQuery((type, payload) =>
    dispatcher.query(type, payload, requireRequestSessionUser(c, "query")),
  );
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
  readonly rateLimitResolver: RateLimitResolver | undefined;
  readonly onVerifiedRateLimitFailOpen: (err: unknown) => void;
};

async function verifiedRateLimitResponse(
  c: Context,
  route: SignatureExtraRoute<unknown>,
  verified: unknown,
  shared: ExtraRouteHonoHandlerDeps,
): Promise<Response | undefined> {
  const rateLimit = route.verifiedRateLimit;
  const resolver = shared.rateLimitResolver;
  if (rateLimit === undefined || resolver === undefined) return undefined;
  // Computed outside the try so a throwing key() is not swallowed as fail-open.
  const bucket = `extra:${route.method} ${route.path}:${rateLimit.key(verified)}`;
  let decision: RateLimitDecision;
  try {
    decision = await resolver.check(bucket, {
      limit: rateLimit.limit,
      windowSeconds: rateLimit.windowSeconds,
    });
  } catch (e) {
    shared.onVerifiedRateLimitFailOpen(e);
    return undefined;
  }
  if (decision.allowed) {
    setRateLimitHeaders(c, decision);
    return undefined;
  }
  if (rateLimit.rejectionBody === undefined) return respondRateLimited(c, decision, bucket);
  c.header("Retry-After", String(Math.max(1, decision.retryAfterSeconds)));
  setRateLimitHeaders(c, decision);
  return c.json(rateLimit.rejectionBody(decision), 429);
}

function buildExtraRouteHonoHandler(
  route: ExtraRouteDefinition,
  shared: ExtraRouteHonoHandlerDeps,
): (c: Context) => Promise<Response> {
  switch (route.entry) {
    case ExtraRouteEntries.anonymous:
      return async (c) =>
        route.handler(c, {
          app: shared.app,
          registry: shared.registry,
          systemQuery: makeSystemQuery(c, shared.dispatcher, shared.clientIpResolver),
          write: makeAnonymousWrite(c, shared.dispatcher),
          query: makeAnonymousQuery(c, shared.dispatcher),
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
          query: bindContractQuery((type, payload) => shared.dispatcher.query(type, payload, user)),
          write: bindContractWrite((type, payload) => shared.dispatcher.write(type, payload, user)),
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
        const limited = await verifiedRateLimitResponse(c, route, verified, shared);
        if (limited !== undefined) return limited;
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
