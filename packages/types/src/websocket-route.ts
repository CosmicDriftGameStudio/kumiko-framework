// WebSocket route definition — feature-declared WebSocket endpoints under
// /api/ws/*. Auth (session + origin) runs before the upgrade; `connect`
// then returns the per-connection handlers or a Response that rejects it.

import type { Context } from "hono";
import type { SessionUser, WriteResult } from "./handlers";

export const WEBSOCKET_MAX_PAYLOAD_BYTES = 1024 * 1024;
export const WEBSOCKET_DEFAULT_MAX_MESSAGE_BYTES = 64 * 1024;
export const WEBSOCKET_ROUTE_PATH_PREFIX = "/api/ws/";

export type WebSocketMessageData = string | Uint8Array;

export type WebSocketConnection = {
  readonly send: (data: WebSocketMessageData) => void;
  readonly close: (code?: number, reason?: string) => void;
};

export type WebSocketSessionHandlers = {
  readonly onOpen?: (connection: WebSocketConnection) => void | Promise<void>;
  readonly onMessage?: (
    data: WebSocketMessageData,
    connection: WebSocketConnection,
  ) => void | Promise<void>;
  readonly onClose?: (code: number, reason: string) => void | Promise<void>;
};

export type WebSocketRouteConnectDeps = {
  readonly user: SessionUser;
  readonly query: (type: string, payload: unknown) => Promise<unknown>;
  readonly write: (type: string, payload: unknown) => Promise<WriteResult>;
  /** Resolved via the server's trustedProxyHops-aware resolver, like HttpRouteHandlerDeps.clientIp. */
  readonly clientIp: string;
};

export type WebSocketRouteDefinition = {
  /** Must start with "/api/ws/"; `:param` segments allowed, no "*". */
  readonly path: string;
  /** Per-message cap; oversized messages close the socket with 1009. Default 64 KiB, max 1 MiB. */
  readonly maxMessageBytes?: number;
  /** Runs after auth + origin checks, before the upgrade. Returning a Response rejects the upgrade with it. */
  readonly connect: (
    // biome-ignore lint/suspicious/noExplicitAny: Hono context generics are invisible at the framework boundary
    c: Context<any, any>,
    deps: WebSocketRouteConnectDeps,
  ) => WebSocketSessionHandlers | Response | Promise<WebSocketSessionHandlers | Response>;
};
