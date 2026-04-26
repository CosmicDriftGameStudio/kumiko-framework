import { defineFeature } from "@kumiko/framework/engine";
import { rateLimitStatus } from "./handlers/status.query";

// Opt-in feature. Loading it does NOT install rate-limit middleware —
// the framework auto-wires the L3 dispatcher hook and the resolver
// when (a) at least one handler declared a rateLimit option, OR (b) the
// caller passed `context.rateLimit` explicitly (e.g. for L1/L2 setup).
//
// Loading this feature only adds the ops-side status query. Apps that
// only use L3 (handler-opt-in) and don't need ops introspection can
// skip this feature entirely — the resolver still runs.
export function createRateLimitingFeature() {
  return defineFeature("rateLimiting", (r) => {
    r.queryHandler(rateLimitStatus);
  });
}
