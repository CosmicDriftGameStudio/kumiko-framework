import { createNoopProvider } from "./noop-provider";
import { registerStandardMetrics } from "./standard-metrics";
import type { Meter, ObservabilityProvider, Tracer } from "./types";

// Lazy fallback provider for call-sites that construct pipeline components
// (dispatcher, lifecycle-pipeline, job-runner) directly without going
// through buildServer. Shared singleton — allocating one NoopProvider per
// module would work too, but this keeps memory flat and lets us verify in
// tests that unconfigured meters don't accumulate state.
//
// Standard metrics are registered on first access so that emitters
// (emitDispatcherHandler, emitEventConsumerLag, ...) don't throw "gauge
// not registered" when the caller skipped buildServer. The NoopMeter's
// strict registration check catches typos in named-metric code at test
// time — we keep that guarantee for named feature metrics while making
// the framework's own standard metrics always safe to emit.

let provider: ObservabilityProvider | undefined;

export function getFallbackProvider(): ObservabilityProvider {
  if (!provider) {
    provider = createNoopProvider();
    registerStandardMetrics(provider.meter);
  }
  return provider;
}

export function getFallbackTracer(): Tracer {
  return getFallbackProvider().tracer;
}

export function getFallbackMeter(): Meter {
  return getFallbackProvider().meter;
}
