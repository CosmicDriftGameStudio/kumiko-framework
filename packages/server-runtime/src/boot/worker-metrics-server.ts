// /metrics for HTTP-less worker pods: the worker entrypoint has no Hono app,
// so scraping needs its own tiny server on a dedicated port.

import {
  createMetricsApp,
  isPrometheusMeter,
  type MetricsRouteOptions,
} from "@cosmicdrift/kumiko-framework/api";
import type { WorkerEntrypoint } from "@cosmicdrift/kumiko-framework/entrypoint";
import type { ObservabilityProvider } from "@cosmicdrift/kumiko-framework/observability";

export type WorkerMetricsOptions = MetricsRouteOptions & {
  /** Port of the scrape server. 0 picks a free port (tests). */
  readonly port: number;
};

export type WorkerMetricsServer = { readonly port: number };

/** Fails the boot (also under KUMIKO_DRY_RUN_ENV=boot) on a metrics config
 *  that would otherwise only surface as a 503 on the first scrape. */
export function assertWorkerMetricsOptions(
  metrics: WorkerMetricsOptions | undefined,
  observability: ObservabilityProvider | undefined,
  processName: string,
): void {
  // skip: metrics not configured, nothing to validate
  if (!metrics) return;
  if (!Number.isInteger(metrics.port) || metrics.port < 0 || metrics.port > 65535) {
    throw new Error(
      `[${processName}] metrics.port must be an integer between 0 and 65535, got ${metrics.port}`,
    );
  }
  if (!observability || !isPrometheusMeter(observability.meter)) {
    throw new Error(
      `[${processName}] metrics is set but observability has no PrometheusMeter — pass observability: { ...createNoopProvider(), meter: createPrometheusMeter() }`,
    );
  }
}

export function startWorkerMetricsServer(
  metrics: WorkerMetricsOptions,
  entrypoint: WorkerEntrypoint,
): WorkerMetricsServer {
  const app = createMetricsApp(entrypoint.observability.meter, metrics);
  const server = Bun.serve({ port: metrics.port, fetch: app.fetch });
  entrypoint.lifecycle.registerShutdownHook("metrics-server", async () => {
    await server.stop();
  });
  // Bun.serve with a bound TCP port always reports one.
  return { port: server.port ?? metrics.port };
}
