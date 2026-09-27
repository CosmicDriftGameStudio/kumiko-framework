import { DEFAULT_MAX_REQUEST_BYTES } from "@cosmicdrift/kumiko-framework/api";
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

/**
 * Bun.serve-Options für Production.
 *
 * Spec: idleTimeout: 0 (= disabled). SSE-Streams werden via Heartbeat
 * lebend gehalten (siehe SSE_HEARTBEAT_INTERVAL_MS in framework/api/
 * sse-route.ts), kein Bun-side Idle-Cleanup nötig. Mit dem Default
 * von 10 s killt Bun nach jedem Heartbeat-Gap die Connection mit
 * halbem HTTP/2-RST_STREAM → Browser ERR_HTTP2_PROTOCOL_ERROR.
 *
 * Spec-Test in __tests__/run-prod-app-spec.test.ts pinst die 0 gegen
 * "looks like a leak"-Reverts.
 */
export function buildBunServeOptions(
  port: number,
  fetchHandler: (req: Request, socketAddress?: string) => Response | Promise<Response>,
  maxRequestBodySize: number = DEFAULT_MAX_REQUEST_BODY_SIZE_BYTES,
): {
  readonly port: number;
  readonly fetch: (req: Request, server: Bun.Server<unknown>) => Response | Promise<Response>;
  readonly idleTimeout: number;
  readonly maxRequestBodySize: number;
} {
  // `server.requestIP(req)` only resolves for the exact Request instance
  // Bun created — extracted here, once, before any downstream req.clone()
  // (tryHonoFirst et al.) can invalidate it.
  return {
    port,
    fetch: (req, server) => fetchHandler(req, server.requestIP(req)?.address),
    idleTimeout: 0,
    maxRequestBodySize,
  };
}
