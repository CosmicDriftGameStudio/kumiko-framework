import { createNoopProvider } from "./noop-provider";
import type { Meter, ObservabilityProvider, Tracer } from "./types";

// Lazy fallback provider for call-sites that construct pipeline components
// (dispatcher, lifecycle-pipeline, outbox-poller, job-runner) directly
// without going through buildServer. Shared singleton — allocating one
// NoopProvider per module would work too, but this keeps memory flat and
// lets us verify in tests that unconfigured meters don't accumulate state.

let provider: ObservabilityProvider | undefined;

export function getFallbackProvider(): ObservabilityProvider {
  if (!provider) provider = createNoopProvider();
  return provider;
}

export function getFallbackTracer(): Tracer {
  return getFallbackProvider().tracer;
}

export function getFallbackMeter(): Meter {
  return getFallbackProvider().meter;
}
