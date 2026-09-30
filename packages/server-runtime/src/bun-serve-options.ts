import {
  DEFAULT_MAX_REQUEST_BYTES,
  isWebSocketUpgradeRequest,
  type KumikoServeEnv,
  type KumikoWebSocketData,
  kumikoWebSocketHandler,
  WEBSOCKET_MAX_PAYLOAD_BYTES,
  WEBSOCKET_ROUTE_PATH_PREFIX,
} from "@cosmicdrift/kumiko-framework/api";
import type { Registry } from "@cosmicdrift/kumiko-framework/engine/types";
import {
  readFilesRouteOptions,
  resolveMaxUploadBodyBytes,
} from "@cosmicdrift/kumiko-framework/files";

// Fallback for callers that skip resolveDerivedMaxRequestBodySize below —
// Bun's own default is 128 MiB, buffered per request before any app-level
// body-limit middleware runs.
export const DEFAULT_MAX_REQUEST_BODY_SIZE_BYTES = 32 * 1024 * 1024;

// Keeps Bun's cap above the files route's own derived bodyLimit, so that
// route's JSON 413 fires before Bun's bare rejection would.
const BUN_BODY_LIMIT_SAFETY_MARGIN_BYTES = 8 * 1024;

// Derives Bun's request-body ceiling from the same registry-configured
// maxUploadSize/field maxSize the upload route itself enforces.
export function resolveDerivedMaxRequestBodySize(registry: Registry): number {
  const filesRouteOptions = readFilesRouteOptions(registry);
  return (
    Math.max(
      DEFAULT_MAX_REQUEST_BYTES,
      resolveMaxUploadBodyBytes({ registry, maxUploadSize: filesRouteOptions.maxUploadSize }),
    ) + BUN_BODY_LIMIT_SAFETY_MARGIN_BYTES
  );
}

// Other upgrades (dev HMR, ...) keep going through fetchHandler.
function isKumikoWebSocketUpgrade(req: Request): boolean {
  return (
    isWebSocketUpgradeRequest(req) &&
    new URL(req.url).pathname.startsWith(WEBSOCKET_ROUTE_PATH_PREFIX)
  );
}

/**
 * Bun.serve options for production.
 *
 * idleTimeout: 0 (disabled): SSE streams stay alive through their own
 * heartbeat (SSE_HEARTBEAT_INTERVAL_MS in framework/api/sse-route.ts). With
 * Bun's 10 s default, every heartbeat gap killed the connection with a half
 * HTTP/2 RST_STREAM, which browsers report as ERR_HTTP2_PROTOCOL_ERROR.
 *
 * __tests__/run-prod-app-spec.test.ts pins the 0 against "looks like a
 * leak" reverts.
 *
 * WebSocket: upgrade requests are branched off here, before `fetchHandler`
 * (whose static/SPA layers clone the request, which `server.upgrade` can't
 * use), into `webSocketUpgradeFetch` with the original Request.
 */
export function buildBunServeOptions(
  port: number,
  fetchHandler: (req: Request, socketAddress?: string) => Response | Promise<Response>,
  maxRequestBodySize: number = DEFAULT_MAX_REQUEST_BODY_SIZE_BYTES,
  webSocketUpgradeFetch?: (req: Request, env: KumikoServeEnv) => Response | Promise<Response>,
): {
  readonly port: number;
  readonly fetch: (
    req: Request,
    server: Bun.Server<KumikoWebSocketData>,
  ) => Response | Promise<Response>;
  readonly idleTimeout: number;
  readonly maxRequestBodySize: number;
  readonly websocket: Bun.WebSocketHandler<KumikoWebSocketData>;
} {
  // `server.requestIP(req)` only resolves for the exact Request instance
  // Bun created — extracted here, once, before any downstream req.clone()
  // (tryHonoFirst et al.) can invalidate it.
  return {
    port,
    fetch: (req, server) => {
      const socketAddress = server.requestIP(req)?.address;
      if (webSocketUpgradeFetch && isKumikoWebSocketUpgrade(req)) {
        return webSocketUpgradeFetch(req, {
          ...(socketAddress !== undefined ? { socketAddress } : {}),
          server,
        });
      }
      return fetchHandler(req, socketAddress);
    },
    idleTimeout: 0,
    maxRequestBodySize,
    websocket: { ...kumikoWebSocketHandler, maxPayloadLength: WEBSOCKET_MAX_PAYLOAD_BYTES },
  };
}
