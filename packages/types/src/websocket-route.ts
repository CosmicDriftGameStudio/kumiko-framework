// WebSocket route definition — feature-declared WebSocket endpoints under
// /api/ws/*. Auth (session + origin) runs before the upgrade; `connect`
// then returns the per-connection handlers or a Response that rejects it.

import type { Context } from "hono";
import type { SessionUser, WriteResult } from "./handlers";

export const WEBSOCKET_MAX_PAYLOAD_BYTES = 1024 * 1024;
export const WEBSOCKET_DEFAULT_MAX_MESSAGE_BYTES = 64 * 1024;
export const WEBSOCKET_ROUTE_PATH_PREFIX = "/api/ws/";
// Bun closes a socket whose unsent outbound queue exceeds this (slow or stalled reader).
export const WEBSOCKET_BACKPRESSURE_LIMIT_BYTES = 4 * 1024 * 1024;
export const WEBSOCKET_DEFAULT_MAX_CONNECTIONS_PER_USER = 5;
export const WEBSOCKET_MAX_CONNECTIONS_PER_USER_LIMIT = 100;

export type WebSocketMessageData = string | Uint8Array;

export type WebSocketConnection = {
  readonly send: (data: WebSocketMessageData) => void;
  readonly close: (code?: number, reason?: string) => void;
  /**
   * Aborts when the socket closes. onClose can run while onOpen/onMessage is
   * still awaiting, so after any await that allocates (e.g. an upstream
   * session), check `signal.aborted` and release it yourself.
   */
  readonly signal: AbortSignal;
};

export type WebSocketSessionHandlers = {
  /** May still be awaiting when onClose runs; see `WebSocketConnection.signal`. */
  readonly onOpen?: (connection: WebSocketConnection) => void | Promise<void>;
  readonly onMessage?: (
    data: WebSocketMessageData,
    connection: WebSocketConnection,
  ) => void | Promise<void>;
  /** Runs immediately on close, not queued behind a slow onMessage; pending messages never start after it. */
  readonly onClose?: (
    code: number,
    reason: string,
    connection: WebSocketConnection,
  ) => void | Promise<void>;
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
  /** Concurrent sockets per user and tenant on this route (per server process). Default 5, max 100; above it the upgrade gets 429. */
  readonly maxConnectionsPerUser?: number;
  /**
   * Runs after auth + origin checks, before the upgrade. Returning a Response rejects the upgrade with it.
   * Allocate per-connection resources in `onOpen`, not here: if the upgrade then fails, no `onClose` runs.
   */
  readonly connect: (
    // biome-ignore lint/suspicious/noExplicitAny: Hono context generics are invisible at the framework boundary
    c: Context<any, any>,
    deps: WebSocketRouteConnectDeps,
  ) => WebSocketSessionHandlers | Response | Promise<WebSocketSessionHandlers | Response>;
};
