import {
  WEBSOCKET_BACKPRESSURE_LIMIT_BYTES,
  WEBSOCKET_DEFAULT_MAX_CONNECTIONS_PER_USER,
  WEBSOCKET_DEFAULT_MAX_MESSAGE_BYTES,
  WEBSOCKET_MAX_PAYLOAD_BYTES,
  WEBSOCKET_ROUTE_PATH_PREFIX,
  type WebSocketConnection,
  type WebSocketMessageData,
  type WebSocketSessionHandlers,
} from "@cosmicdrift/kumiko-types/websocket-route";
import type { SessionUser } from "../engine/types";
import { createFallbackLogger } from "../logging";
import {
  type AuthSessionChecker,
  resolveTenantTeardownStatus,
  sessionCheckStatus,
  type TenantLifecycleStatusResolver,
} from "./auth-middleware";
import { type RequestContextData, requestContext } from "./request-context";

export {
  WEBSOCKET_BACKPRESSURE_LIMIT_BYTES,
  WEBSOCKET_DEFAULT_MAX_CONNECTIONS_PER_USER,
  WEBSOCKET_DEFAULT_MAX_MESSAGE_BYTES,
  WEBSOCKET_MAX_PAYLOAD_BYTES,
  WEBSOCKET_ROUTE_PATH_PREFIX,
};

// Must stay below ingress-nginx's default 60 s proxy-read-timeout, or idle sockets get cut.
export const WEBSOCKET_HEARTBEAT_INTERVAL_MS = 25_000;

const CLOSE_POLICY_VIOLATION = 1008;
const CLOSE_MESSAGE_TOO_BIG = 1009;
const CLOSE_INTERNAL_ERROR = 1011;
const CLOSE_TRY_AGAIN_LATER = 1013;

// Consecutive failed session-store checks before a socket is closed: rides out a
// short store blip, but a socket must not stay unverified forever.
export const WEBSOCKET_REVALIDATION_FAILURE_LIMIT = 3;

const log = createFallbackLogger("websocket");

export type KumikoWebSocketData = {
  readonly handlers: WebSocketSessionHandlers;
  readonly maxMessageBytes: number;
  // Socket callbacks run outside the Hono request, so the dispatcher's
  // AsyncLocalStorage context is captured at upgrade time and re-entered.
  readonly requestContextData: RequestContextData | undefined;
  readonly revalidateSession: WebSocketSessionRevalidator | undefined;
  // Frees this socket's per-user connection slot; called once on close.
  readonly releaseConnectionSlot?: (() => void) | undefined;
};

export type WebSocketRevalidation = "live" | "expired" | "invalid";
export type WebSocketSessionRevalidator = () => Promise<WebSocketRevalidation>;

// Structural so Bun.Server satisfies it without this package depending on bun types.
export type WebSocketUpgradeServer = {
  upgrade(req: Request, options: { data: KumikoWebSocketData }): boolean;
};

// Second argument to `app.fetch(req, env)` on upgrade requests; plain requests
// keep passing the bare socket-address string.
export type KumikoServeEnv = {
  readonly socketAddress?: string;
  readonly server?: WebSocketUpgradeServer;
};

export type KumikoServerWebSocket = {
  readonly data: KumikoWebSocketData;
  send(data: WebSocketMessageData): unknown;
  close(code?: number, reason?: string): void;
  ping(): unknown;
};

export function isWebSocketUpgradeRequest(req: Request): boolean {
  return req.headers.get("upgrade")?.toLowerCase() === "websocket";
}

export function hasWebSocketUpgradeServer(
  honoEnv: unknown,
): honoEnv is { readonly server: WebSocketUpgradeServer } {
  return (
    typeof honoEnv === "object" &&
    honoEnv !== null &&
    "server" in honoEnv &&
    typeof honoEnv.server === "object" &&
    honoEnv.server !== null &&
    "upgrade" in honoEnv.server &&
    typeof honoEnv.server.upgrade === "function"
  );
}

function sameRoles(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  return left.size === new Set(b).size && b.every((role) => left.has(role));
}

// Same checks the HTTP guard runs per request, plus the JWT's own expiry (the
// upgrade request passed the guard once, the socket outlives that). query/write
// stay bound to the upgrade-time user, so changed roles close the socket
// instead of silently serving stale permissions.
export function buildWebSocketSessionRevalidator(deps: {
  readonly user: SessionUser;
  readonly sessionChecker?: AuthSessionChecker | undefined;
  readonly resolveTenantLifecycleStatus?: TenantLifecycleStatusResolver | undefined;
  /** JWT exp, epoch seconds. */
  readonly tokenExpiresAtSec?: number | undefined;
  readonly nowMs?: () => number;
}): WebSocketSessionRevalidator | undefined {
  const { user, sessionChecker, resolveTenantLifecycleStatus, tokenExpiresAtSec } = deps;
  const nowMs = deps.nowMs ?? Date.now;
  const checkSession = sessionChecker && user.sid ? sessionChecker : undefined;
  if (!checkSession && !resolveTenantLifecycleStatus && tokenExpiresAtSec === undefined) {
    return undefined;
  }
  return async () => {
    if (tokenExpiresAtSec !== undefined && nowMs() >= tokenExpiresAtSec * 1000) return "expired";
    if (checkSession && user.sid) {
      const result = await checkSession(user.sid, user.id);
      if (sessionCheckStatus(result) !== "live") return "invalid";
      if (typeof result === "object" && !sameRoles(result.roles, user.roles)) return "invalid";
    }
    const teardown = await resolveTenantTeardownStatus(user.tenantId, resolveTenantLifecycleStatus);
    return teardown === undefined ? "live" : "invalid";
  };
}

// ponytail: per-process counter, so the cap is per pod, not cluster-wide; move to Redis if that matters.
export type WebSocketConnectionLimiter = {
  readonly tryAcquire: (key: string, max: number) => (() => void) | undefined;
};

export function createWebSocketConnectionLimiter(): WebSocketConnectionLimiter {
  const counts = new Map<string, number>();
  return {
    tryAcquire(key, max) {
      const current = counts.get(key) ?? 0;
      if (current >= max) return undefined;
      counts.set(key, current + 1);
      let released = false;
      return () => {
        // skip: slot already released
        if (released) return;
        released = true;
        const remaining = (counts.get(key) ?? 1) - 1;
        if (remaining <= 0) counts.delete(key);
        else counts.set(key, remaining);
      };
    },
  };
}

type ConnectionState = {
  timer: ReturnType<typeof setInterval> | undefined;
  revalidationFailures: number;
  revalidating: boolean;
  // onOpen/onMessage/onClose run one after another in arrival order; steps never reject.
  chain: Promise<void>;
};

const connectionStates = new WeakMap<KumikoWebSocketData, ConnectionState>();

function stateOf(ws: KumikoServerWebSocket): ConnectionState {
  let state = connectionStates.get(ws.data);
  if (!state) {
    state = {
      timer: undefined,
      revalidationFailures: 0,
      revalidating: false,
      chain: Promise.resolve(),
    };
    connectionStates.set(ws.data, state);
  }
  return state;
}

function toConnection(ws: KumikoServerWebSocket): WebSocketConnection {
  return {
    send: (data) => {
      ws.send(data);
    },
    close: (code, reason) => ws.close(code, reason),
  };
}

function enqueue(ws: KumikoServerWebSocket, run: () => void | Promise<void>): void {
  const step = async (): Promise<void> => {
    try {
      await run();
    } catch (error) {
      log.error("websocket handler failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      ws.close(CLOSE_INTERNAL_ERROR, "internal error");
    }
  };
  const { requestContextData } = ws.data;
  const state = stateOf(ws);
  state.chain = state.chain.then(() =>
    requestContextData ? requestContext.run(requestContextData, step) : step(),
  );
}

function recordRevalidationFailure(
  ws: KumikoServerWebSocket,
  state: ConnectionState,
  reason: string,
): void {
  // One failing check must not drop every live socket during a store blip, but persistent failure must.
  state.revalidationFailures += 1;
  log.error("websocket heartbeat failed", {
    error: reason,
    consecutiveFailures: state.revalidationFailures,
  });
  if (state.revalidationFailures >= WEBSOCKET_REVALIDATION_FAILURE_LIMIT) {
    ws.close(CLOSE_TRY_AGAIN_LATER, "try again later");
  }
}

async function heartbeat(ws: KumikoServerWebSocket): Promise<void> {
  const state = stateOf(ws);
  try {
    ws.ping();
  } catch (error) {
    log.error("websocket ping failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const { revalidateSession } = ws.data;
  // skip: no revalidation wired for this socket
  if (!revalidateSession) return;
  // A store that never answers must not pile up checks; an unanswered one counts as a failed check.
  if (state.revalidating) {
    recordRevalidationFailure(ws, state, "previous session check still pending");
    // skip: the pending check owns the verdict; the failure was logged above
    return;
  }
  state.revalidating = true;
  try {
    const verdict = await revalidateSession();
    state.revalidationFailures = 0;
    if (verdict === "expired") ws.close(CLOSE_POLICY_VIOLATION, "session expired");
    else if (verdict === "invalid") ws.close(CLOSE_POLICY_VIOLATION, "session changed");
  } catch (error) {
    recordRevalidationFailure(ws, state, error instanceof Error ? error.message : String(error));
  } finally {
    state.revalidating = false;
  }
}

function toMessageData(message: string | Uint8Array): WebSocketMessageData {
  if (typeof message === "string") return message;
  // Copy: a Buffer view can sit on a larger pooled ArrayBuffer and be reused after the handler returns.
  return new Uint8Array(message);
}

function messageByteLength(message: string | Uint8Array): number {
  return typeof message === "string" ? Buffer.byteLength(message) : message.byteLength;
}

export function createKumikoWebSocketHandler(
  options: { readonly heartbeatIntervalMs?: number } = {},
) {
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? WEBSOCKET_HEARTBEAT_INTERVAL_MS;
  return {
    open(ws: KumikoServerWebSocket): void {
      stateOf(ws).timer = setInterval(() => {
        void heartbeat(ws);
      }, heartbeatIntervalMs);
      const { onOpen } = ws.data.handlers;
      if (onOpen) enqueue(ws, () => onOpen(toConnection(ws)));
    },
    message(ws: KumikoServerWebSocket, message: string | Uint8Array): void {
      const byteLength = messageByteLength(message);
      if (byteLength > ws.data.maxMessageBytes) {
        ws.close(CLOSE_MESSAGE_TOO_BIG, "message too big");
        log.warn("websocket message over cap", {
          byteLength,
          maxMessageBytes: ws.data.maxMessageBytes,
        });
        return;
      }
      const { onMessage } = ws.data.handlers;
      if (onMessage) enqueue(ws, () => onMessage(toMessageData(message), toConnection(ws)));
    },
    close(ws: KumikoServerWebSocket, code: number, reason: string): void {
      const state = stateOf(ws);
      if (state.timer !== undefined) {
        clearInterval(state.timer);
        state.timer = undefined;
      }
      ws.data.releaseConnectionSlot?.();
      const { onClose } = ws.data.handlers;
      if (onClose) enqueue(ws, () => onClose(code, reason));
    },
  };
}

export const kumikoWebSocketHandler = createKumikoWebSocketHandler();
