import type { Hono } from "hono";
import type { WebSocketRouteDefinition } from "../engine/types/index.ts";
import { createFallbackLogger } from "../logging/index.ts";
import type { Dispatcher } from "../pipeline/dispatcher.ts";
import {
  type AuthSessionChecker,
  getAuthTokenExpiry,
  getUser,
  type TenantLifecycleStatusResolver,
} from "./auth-middleware.ts";
import { type ClientIpResolver, clientIpSourceFromHonoContext } from "./client-ip.ts";
import { isWebSocketOriginAllowed, normalizeOrigin, rejectOrigin } from "./origin-middleware.ts";
import { requestContext } from "./request-context.ts";
import type { RequestContextData } from "./request-context-internals.ts";

import { isMissingOrAnonymousUser, unauthenticatedResponse } from "./server-routes.ts";
import type { ServerWiring } from "./server-wiring.ts";
import {
  buildWebSocketSessionRevalidator,
  createWebSocketConnectionLimiter,
  hasWebSocketUpgradeServer,
  isWebSocketUpgradeRequest,
  WEBSOCKET_DEFAULT_MAX_CONNECTIONS_PER_USER,
  WEBSOCKET_DEFAULT_MAX_MESSAGE_BYTES,
  type WebSocketConnectionLimiter,
} from "./websocket-route.ts";

export function mountWebSocketRoutes(
  app: Hono,
  wiring: Pick<ServerWiring, "options" | "dispatcher" | "clientIpResolver">,
  tenantLifecycleResolver: TenantLifecycleStatusResolver | undefined,
): void {
  const { options, dispatcher, clientIpResolver } = wiring;
  // r.webSocketRoute — GET routes under /api/ws/*, so the jwt/pat/rate-limit
  // chain above already ran. Origin/CSRF guards skip GETs, hence the own check.
  const webSocketOriginAllowlist = options.auth?.allowedOrigins?.length
    ? new Set(options.auth.allowedOrigins.map(normalizeOrigin))
    : undefined;
  const webSocketRoutePaths = new Map<string, string>();
  const webSocketConnectionLimiter = createWebSocketConnectionLimiter();
  for (const feature of options.registry.features.values()) {
    for (const route of Object.values(feature.webSocketRoutes)) {
      const owner = webSocketRoutePaths.get(route.path);
      if (owner !== undefined) {
        throw new Error(
          `[kumiko] WebSocket route "${route.path}" is declared by both feature "${owner}" and ` +
            `"${feature.name}" — paths must be unique across features.`,
        );
      }
      webSocketRoutePaths.set(route.path, feature.name);
      app.get(
        route.path,
        buildWebSocketRouteHandler(route, {
          dispatcher,
          clientIpResolver,
          originAllowlist: webSocketOriginAllowlist,
          ...(options.auth?.sessionChecker ? { sessionChecker: options.auth.sessionChecker } : {}),
          ...(tenantLifecycleResolver
            ? { resolveTenantLifecycleStatus: tenantLifecycleResolver }
            : {}),
          connectionLimiter: webSocketConnectionLimiter,
        }),
      );
    }
  }
}

type WebSocketRouteHandlerDeps = {
  readonly dispatcher: Dispatcher;
  readonly clientIpResolver: ClientIpResolver;
  readonly originAllowlist: ReadonlySet<string> | undefined;
  readonly sessionChecker?: AuthSessionChecker;
  readonly resolveTenantLifecycleStatus?: TenantLifecycleStatusResolver;
  readonly connectionLimiter: WebSocketConnectionLimiter;
};

const webSocketLog = createFallbackLogger("websocket");

function webSocketErrorResponse(
  c: import("hono").Context,
  status: 400 | 426 | 429 | 501,
  code: string,
  message: string,
): Response {
  return c.json({ error: { code, httpStatus: status, message } }, status);
}

function buildWebSocketRouteHandler(
  route: WebSocketRouteDefinition,
  shared: WebSocketRouteHandlerDeps,
  // biome-ignore lint/suspicious/noExplicitAny: Hono context generics are invisible at the framework boundary
): (c: import("hono").Context<any, any>) => Promise<Response> {
  return async (c) => {
    if (!isWebSocketOriginAllowed(c, shared.originAllowlist)) return rejectOrigin(c);
    const user = getUser(c);
    if (isMissingOrAnonymousUser(user)) return unauthenticatedResponse(c);
    if (!isWebSocketUpgradeRequest(c.req.raw)) {
      return webSocketErrorResponse(
        c,
        426,
        "websocket_upgrade_required",
        "this route only accepts WebSocket upgrade requests",
      );
    }
    const honoEnv: unknown = c.env;
    if (!hasWebSocketUpgradeServer(honoEnv)) {
      const message = "webSocketUpgradeFetch not wired: pass it to buildBunServeOptions";
      webSocketLog.error(message, { path: route.path });
      return webSocketErrorResponse(c, 501, "websocket_upgrade_not_wired", message);
    }
    // The slot is taken before connect (a refused attempt must not run it) and stays synchronous with
    // the check, so concurrent upgrades can't overshoot the cap. Every path without a live socket frees it.
    const releaseConnectionSlot = shared.connectionLimiter.tryAcquire(
      `${route.path}\n${user.tenantId}\n${user.id}`,
      route.maxConnectionsPerUser ?? WEBSOCKET_DEFAULT_MAX_CONNECTIONS_PER_USER,
    );
    if (!releaseConnectionSlot) {
      return webSocketErrorResponse(
        c,
        429,
        "websocket_connection_limit",
        "too many open WebSocket connections for this user",
      );
    }
    let upgraded = false;
    try {
      const handlers = await route.connect(c, {
        user,
        query: (type, payload) => shared.dispatcher.query(type, payload, user),
        write: (type, payload) => shared.dispatcher.write(type, payload, user),
        clientIp: shared.clientIpResolver.resolve(clientIpSourceFromHonoContext(c)),
      });
      if (handlers instanceof Response) return handlers;

      const captured = requestContext.get();
      const requestContextData = captured ? withoutAbortSignal(captured) : undefined;
      const revalidateSession = buildWebSocketSessionRevalidator({
        user,
        sessionChecker: shared.sessionChecker,
        resolveTenantLifecycleStatus: shared.resolveTenantLifecycleStatus,
        tokenExpiresAtSec: getAuthTokenExpiry(c),
      });
      upgraded = honoEnv.server.upgrade(c.req.raw, {
        data: {
          handlers,
          maxMessageBytes: route.maxMessageBytes ?? WEBSOCKET_DEFAULT_MAX_MESSAGE_BYTES,
          requestContextData,
          revalidateSession,
          releaseConnectionSlot,
        },
      });
      if (!upgraded) {
        return webSocketErrorResponse(
          c,
          400,
          "websocket_upgrade_failed",
          "the WebSocket upgrade was rejected",
        );
      }
      // Bun ignores the returned Response after a successful upgrade.
      return new Response(null);
    } finally {
      if (!upgraded) releaseConnectionSlot();
    }
  };
}

// The request's AbortSignal fires when the upgrade request ends, which would
// abort every later handler running under the captured context.
function withoutAbortSignal(data: RequestContextData): RequestContextData {
  const { signal: _signal, ...rest } = data;
  return rest;
}
