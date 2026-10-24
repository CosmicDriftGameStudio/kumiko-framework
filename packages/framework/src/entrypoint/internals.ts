import type { JwtKeyring } from "../api/jwt.ts";
import type { ServerOptions } from "../api/server.ts";
import type { RowLevelSecurityMode } from "../db/render-rls-ddl.ts";
import type { AppContext, Registry } from "../engine/types/index.ts";
import type { JobRunnerOptions } from "../jobs/job-runner.ts";
import type { Lifecycle } from "../lifecycle/index.ts";
import type { ObservabilityProvider } from "../observability/index.ts";
import type { DispatcherOptions } from "../pipeline/dispatcher.ts";
import type { EventDedup } from "../pipeline/event-dedup.ts";
import type { SystemHooks } from "../pipeline/lifecycle-pipeline.ts";
import type { ApiEntrypointOptions } from "./index.ts";

// Shared fields across all three modes. A caller that swaps between
// modes can reuse the same options object.
export type BaseEntrypointOptions = {
  readonly registry: Registry;
  readonly context: AppContext;
  readonly jwtSecret: string | JwtKeyring;
  readonly jwtIssuer?: string;
  readonly observability?: ObservabilityProvider;
  readonly dispatcherOptions?: Omit<DispatcherOptions, "lifecycle">;
  readonly systemHooks?: SystemHooks;
  readonly eventDedup?: EventDedup;
  // Optional pre-built lifecycle. If omitted, each factory builds its own.
  // Pass one in when you want to register caller-specific shutdown hooks
  // alongside the framework's.
  readonly lifecycle?: Lifecycle;
  readonly instanceId?: ServerOptions["instanceId"];
  /** Must equal the mode of `context.db`; default "off". */
  readonly rowLevelSecurity?: RowLevelSecurityMode;
};

// Shape the JobRunner block takes in every entrypoint mode. Extracted so
// adding a new JobRunnerOption doesn't need three parallel changes.
export type JobsBlock = {
  readonly redisUrl: string;
  readonly queueNamePrefix?: string;
  readonly getActiveTenantIds?: JobRunnerOptions["getActiveTenantIds"];
  readonly onJobStart?: JobRunnerOptions["onJobStart"];
  readonly onJobComplete?: JobRunnerOptions["onJobComplete"];
  readonly onJobFailed?: JobRunnerOptions["onJobFailed"];
  readonly onJobDeferred?: JobRunnerOptions["onJobDeferred"];
  readonly onJobQueued?: JobRunnerOptions["onJobQueued"];
  readonly onJobDropped?: JobRunnerOptions["onJobDropped"];
};

export type WorkerEntrypointOptions = BaseEntrypointOptions &
  JobsBlock & {
    // Tuning knobs for the event-dispatcher loop. Workers typically set a
    // pgClient so LISTEN/NOTIFY drops the poll latency from seconds to TCP
    // round-trip.
    readonly eventDispatcher?: ServerOptions["eventDispatcher"];
  };

export type AllInOneEntrypointOptions = ApiEntrypointOptions & WorkerEntrypointOptions;
