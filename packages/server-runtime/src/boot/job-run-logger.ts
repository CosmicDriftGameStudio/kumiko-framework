import { createJobRunLogger } from "@cosmicdrift/kumiko-bundled-features/jobs";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import type {
  AppContext,
  DispatchWriteRef,
  JobRunIn,
} from "@cosmicdrift/kumiko-framework/engine/types";
import { createJobRunner, type JobRunner } from "@cosmicdrift/kumiko-framework/jobs";
import type { Dispatcher } from "@cosmicdrift/kumiko-framework/pipeline";

export function jobRunLoggerCallbacks(
  registry: Registry,
  db: DbConnection,
): ReturnType<typeof createJobRunLogger> | undefined {
  if (registry.getFeature("jobs") === undefined) return undefined;
  return createJobRunLogger({ db, registry });
}

// Same adapter as the prod entrypoints' dispatcherToWriteRef (entrypoint/
// index.ts) — DispatchWriteRef's (user, qn, payload) shape vs. Dispatcher's
// (type, payload, user). Duplicated here because the entrypoint's version
// isn't exported: dev boot builds its own dispatcher via setupTestStack
// rather than going through createApiEntrypoint/createWorkerEntrypoint.
function dispatcherToWriteRef(dispatcher: Dispatcher): DispatchWriteRef {
  return {
    write: (user, qn, payload) => dispatcher.write(qn, payload, user),
    queryAs: (user, qn, payload) => dispatcher.query(qn, payload, user),
  };
}

/** Dev-server parity: consume api + worker lanes when jobs are registered. */
export async function startDevJobRunners(opts: {
  readonly registry: Registry;
  readonly db: DbConnection;
  readonly context: AppContext;
  readonly redisUrl: string;
  readonly dispatcher: Dispatcher;
}): Promise<{ readonly runners: readonly JobRunner[]; readonly stop: () => Promise<void> }> {
  const jobs = [...opts.registry.getAllJobs().values()];
  if (opts.registry.getFeature("jobs") === undefined || jobs.length === 0) {
    return { runners: [], stop: async () => {} };
  }

  const logger = createJobRunLogger({ db: opts.db, registry: opts.registry });
  const runners: JobRunner[] = [];
  // `?? "worker"` mirrors job-runner's laneForJob: a job without an explicit
  // runIn is enqueued onto the worker lane, so filtering those out would leave
  // its queue without a consumer whenever no other job named the lane.
  const lanes = new Set<JobRunIn>(jobs.map((j) => j.runIn ?? "worker"));

  for (const lane of lanes) {
    const jr = createJobRunner({
      registry: opts.registry,
      context: { ...opts.context, db: opts.db },
      redisUrl: opts.redisUrl,
      consumerLane: lane,
      ...logger,
    });
    // Without this, ctx.write/ctx.queryAs inside a dev-run job throw
    // "dispatcher attached — call attachDispatcher() first" on their first
    // call — the prod entrypoints (createApiEntrypoint/createWorkerEntrypoint/
    // createAllInOneEntrypoint) do this automatically, dev boot must too
    // (kumiko-framework#2553).
    jr.attachDispatcher(dispatcherToWriteRef(opts.dispatcher));
    await jr.start();
    runners.push(jr);
  }

  return {
    runners,
    stop: async () => {
      for (const runner of runners) await runner.stop();
    },
  };
}
