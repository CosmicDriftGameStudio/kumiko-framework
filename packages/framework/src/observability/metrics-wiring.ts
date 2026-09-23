import { z } from "zod";
import { createNoopProvider } from "./noop-provider";
import { createPrometheusMeter, type PrometheusMeter } from "./prometheus-meter";
import type { ObservabilityProvider } from "./types";

export const prometheusMetricsEnvSchema = z.object({
  PROMETHEUS_METRICS_TOKEN: z
    .string()
    .min(32)
    .optional()
    .describe("Bearer token for /metrics; unset keeps the endpoint off.")
    .meta({ kumiko: { pulumi: { secret: true, generator: "openssl rand -base64 32" } } }),
});

type PrometheusObservabilityProvider = ObservabilityProvider & { readonly meter: PrometheusMeter };

export type ObservabilityWiring =
  | {
      readonly observability: PrometheusObservabilityProvider;
      readonly metrics: { readonly path: string; readonly token: string };
    }
  | Record<string, never>;

// Fail-closed: public tenant hosts share the /metrics port, so no token means no endpoint.
export function resolveObservabilityWiring(metricsToken: string | undefined): ObservabilityWiring {
  if (!metricsToken) return {};
  return {
    // Overrides the spread's name "noop", which would otherwise show up in diagnostics/logs.
    observability: { ...createNoopProvider(), name: "prometheus", meter: createPrometheusMeter() },
    metrics: { path: "/metrics", token: metricsToken },
  };
}
