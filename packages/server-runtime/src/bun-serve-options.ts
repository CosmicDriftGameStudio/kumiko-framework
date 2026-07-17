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
  fetchHandler: (req: Request) => Response | Promise<Response>,
): {
  readonly port: number;
  readonly fetch: (req: Request) => Response | Promise<Response>;
  readonly idleTimeout: number;
} {
  return { port, fetch: fetchHandler, idleTimeout: 0 };
}
