import { createJobRunLogger } from "@cosmicdrift/kumiko-bundled-features/jobs";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import type { JobRunIn } from "@cosmicdrift/kumiko-framework/engine/types";
import { createJobRunner, type JobRunner } from "@cosmicdrift/kumiko-framework/jobs";

export function jobRunLoggerCallbacks(
  registry: Registry,
  db: DbConnection,
): ReturnType<typeof createJobRunLogger> | undefined {
  if (registry.getFeature("jobs") === undefined) return undefined;
  return createJobRunLogger({ db, registry });
}

/** Dev-server parity: consume api + worker lanes when jobs are registered. */
export async function startDevJobRunners(opts: {
  readonly registry: Registry;
  readonly db: DbConnection;
  readonly context: Record<string, unknown>;
  readonly redisUrl: string;
}): Promise<{ readonly runners: readonly JobRunner[]; readonly stop: () => Promise<void> }> {
  const jobs = [...opts.registry.getAllJobs().values()];
  if (opts.registry.getFeature("jobs") === undefined || jobs.length === 0) {
    return { runners: [], stop: async () => {} };
  }

  const logger = createJobRunLogger({ db: opts.db, registry: opts.registry });
  const runners: JobRunner[] = [];
  const lanes = new Set(
    jobs.map((j) => j.runIn).filter((lane): lane is JobRunIn => lane !== undefined),
  );

  for (const lane of lanes) {
    const jr = createJobRunner({
      registry: opts.registry,
      context: { ...opts.context, db: opts.db },
      redisUrl: opts.redisUrl,
      consumerLane: lane,
      ...logger,
    });
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
