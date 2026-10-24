import type { HandlerObservability } from "../engine/types/index.ts";
import { createFallbackFullLogger } from "../logging/utils.ts";
import { getFallbackTracer } from "../observability/fallback.ts";
import {
  createMetricsForFactory,
  createMetricsHandle,
  createNoopMetricsHandle,
} from "../observability/index.ts";

import type { HandlerContextScope } from "./handler-context-scope.ts";

export function buildObservabilityFacet(scope: HandlerContextScope): {
  readonly obs: HandlerObservability;
} {
  const { type, user, context, reqCtx, featureName } = scope;
  const log =
    context.log?.child({
      handler: type,
      tenantId: user.tenantId,
      userId: user.id,
      ...(reqCtx && { requestId: reqCtx.requestId }),
    }) ?? createFallbackFullLogger("handler");
  // Observability — feature-bound metrics handle, so ctx.obs.metrics.inc("foo")
  // resolves to kumiko_<feature>_foo. Unknown feature falls back to noop
  // so legacy internal handlers don't crash.
  const tracer = context.tracer ?? getFallbackTracer();
  const meter = context.meter;
  const metrics =
    meter && featureName ? createMetricsHandle(meter, featureName) : createNoopMetricsHandle();
  // obs.metricsFor(featureName) — shared/library code binds to a feature
  // name of its own choosing instead of the dispatching handler's.
  // Unregistered names no-op rather than throw.
  const metricsFor = createMetricsForFactory(meter);
  return { obs: { log, tracer, metrics, metricsFor, ...(meter && { meter }) } };
}
