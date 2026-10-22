import {
  createMetricsForFactory,
  createMetricsHandle,
  createNoopMetricsHandle,
  getFallbackTracer,
} from "../observability/index.ts";
import type { HandlerContextScope } from "./handler-context-scope.ts";

export function buildObservabilityFacet(scope: HandlerContextScope) {
  const { type, user, context, reqCtx, featureName } = scope;
  const log = context.log?.child({
    handler: type,
    tenantId: user.tenantId,
    userId: user.id,
    ...(reqCtx && { requestId: reqCtx.requestId }),
  });
  // Observability — feature-bound metrics handle, so ctx.metrics.inc("foo")
  // resolves to kumiko_<feature>_foo. Unknown feature falls back to noop
  // so legacy internal handlers don't crash.
  const tracer = context.tracer ?? getFallbackTracer();
  const meter = context.meter;
  const metrics =
    meter && featureName ? createMetricsHandle(meter, featureName) : createNoopMetricsHandle();
  // ctx.metricsFor(featureName) — shared/library code binds to a feature
  // name of its own choosing instead of the dispatching handler's.
  // Unregistered names no-op rather than throw.
  const metricsFor = createMetricsForFactory(meter);
  return { log, tracer, metrics, metricsFor };
}
