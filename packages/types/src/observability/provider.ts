// Observability provider contract — the "plug" that implementations (noop,
// console, otlp, prometheus) fulfil. Configuration types that consumers
// (buildServer, setupTestStack) hand in also live here.

import type { Meter } from "./metric";
import type { Tracer } from "./span";

export type SamplingConfig = {
  // Base sampling rate 0..1. Default 1 in v1 (sample everything).
  readonly tracing?: number;
  readonly alwaysOnError?: boolean;
  readonly alwaysOnSlow?: { readonly thresholdMs: number };
};

export type SensitiveFilterConfig = {
  readonly redactedHeaders: readonly string[];
  readonly redactedQueryParams: readonly string[];
  readonly redactedAttributeKeyPatterns: readonly RegExp[];
};

export type ObservabilityOptions = {
  readonly sampling?: SamplingConfig;
  readonly sensitiveFilter?: Partial<SensitiveFilterConfig>;
};

export interface ObservabilityProvider {
  readonly name: string;
  readonly tracer: Tracer;
  readonly meter: Meter;
  // Graceful flush. Called from framework lifecycle shutdown.
  shutdown(): Promise<void>;
}
