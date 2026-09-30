import {
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
  WEBSOCKET_DEFAULT_MAX_MESSAGE_BYTES,
  WEBSOCKET_MAX_PAYLOAD_BYTES,
  WEBSOCKET_ROUTE_PATH_PREFIX,
};

// Must stay below ingress-nginx's default 60 s proxy-read-timeout, or idle sockets get cut.
export const WEBSOCKET_HEARTBEAT_INTERVAL_MS = 25_000;

const CLOSE_POLICY_VIOLATION = 1008;
const CLOSE_MESSAGE_TOO_BIG = 1009;
const CLOSE_INTERNAL_ERROR = 1011;

const log = createFallbackLogger("websocket");

export type KumikoWebSocketData = {
  readonly handlers: WebSocketSessionHandlers;
  readonly maxMessageBytes: number;
  // Socket callbacks run outside the Hono request, so the dispatcher's
  // AsyncLocalStorage context is captured at upgrade time and re-entered.
  readonly requestContextData: RequestContextData | undefined;
  readonly revalidateSession: (() => Promise<boolean>) | undefined;
};

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

// Same checks the HTTP guard runs per request. query/write stay bound to the
// upgrade-time user, so changed roles close the socket instead of silently
// serving stale permissions.
export function buildWebSocketSessionRevalidator(deps: {
  readonly user: SessionUser;
  readonly sessionChecker?: AuthSessionChecker | undefined;
  readonly resolveTenantLifecycleStatus?: TenantLifecycleStatusResolver | undefined;
}): (() => Promise<boolean>) | undefined {
  const { user, sessionChecker, resolveTenantLifecycleStatus } = deps;
  const checkSession = sessionChecker && user.sid ? sessionChecker : undefined;
  if (!checkSession && !resolveTenantLifecycleStatus) return undefined;
  return async () => {
    if (checkSession && user.sid) {
      const result = await checkSession(user.sid, user.id);
      if (sessionCheckStatus(result) !== "live") return false;
      if (typeof result === "object" && !sameRoles(result.roles, user.roles)) return false;
    }
    return (
      (await resolveTenantTeardownStatus(user.tenantId, resolveTenantLifecycleStatus)) === undefined
    );
  };
}

const heartbeatTimers = new WeakMap<KumikoWebSocketData, ReturnType<typeof setInterval>>();

function toConnection(ws: KumikoServerWebSocket): WebSocketConnection {
  return {
    send: (data) => {
      ws.send(data);
    },
    close: (code, reason) => ws.close(code, reason),
  };
}

function runGuarded(ws: KumikoServerWebSocket, run: () => void | Promise<void>): void {
  const guarded = async (): Promise<void> => {
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
  void (requestContextData ? requestContext.run(requestContextData, guarded) : guarded());
}

async function heartbeat(ws: KumikoServerWebSocket): Promise<void> {
  try {
    ws.ping();
    const { revalidateSession } = ws.data;
    if (revalidateSession && !(await revalidateSession())) {
      ws.close(CLOSE_POLICY_VIOLATION, "session changed");
    }
  } catch (error) {
    // A failing session store must not drop every live socket at once.
    log.error("websocket heartbeat failed", {
      error: error instanceof Error ? error.message : String(error),
    });
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

export const kumikoWebSocketHandler = {
  open(ws: KumikoServerWebSocket): void {
    heartbeatTimers.set(
      ws.data,
      setInterval(() => {
        void heartbeat(ws);
      }, WEBSOCKET_HEARTBEAT_INTERVAL_MS),
    );
    const { onOpen } = ws.data.handlers;
    if (onOpen) runGuarded(ws, () => onOpen(toConnection(ws)));
  },
  message(ws: KumikoServerWebSocket, message: string | Uint8Array): void {
    const byteLength = messageByteLength(message);
    if (byteLength > ws.data.maxMessageBytes) {
      log.warn("websocket message over cap", {
        byteLength,
        maxMessageBytes: ws.data.maxMessageBytes,
      });
      ws.close(CLOSE_MESSAGE_TOO_BIG, "message too big");
      return;
    }
    const { onMessage } = ws.data.handlers;
    if (onMessage) runGuarded(ws, () => onMessage(toMessageData(message), toConnection(ws)));
  },
  close(ws: KumikoServerWebSocket, code: number, reason: string): void {
    const timer = heartbeatTimers.get(ws.data);
    if (timer !== undefined) {
      clearInterval(timer);
      heartbeatTimers.delete(ws.data);
    }
    const { onClose } = ws.data.handlers;
    if (onClose) runGuarded(ws, () => onClose(code, reason));
  },
};
