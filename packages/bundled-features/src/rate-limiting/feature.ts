import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
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
  return defineFeature("rate-limiting", (r) => {
    r.describe(
      "Adds an ops-side `rate-limiting:query:status` query handler for inspecting current bucket state; the actual request throttling is wired automatically by the dispatcher when any handler declares a `rateLimit` option (e.g. `{ per: 'user', limit: 3, windowSeconds: 60 }`) or when you pass `context.rateLimit` to `buildServer`. Loading this feature is optional if you only need L3 per-handler rate limits and have no need for ops introspection.",
    );
    r.uiHints({
      displayLabel: "Rate Limiting · Ops Query",
      category: "operations",
      recommended: false,
    });
    r.queryHandler(rateLimitStatus);
  });
}
