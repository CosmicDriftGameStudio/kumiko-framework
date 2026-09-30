import type { DbConnection } from "../db/index.js";
import { getEventsHighWaterMark } from "../event-store/index.js";
import type { JobRunner } from "../jobs/index.js";
import { type EventDispatcher, getConsumerState } from "../pipeline/index.js";

// Gap between idle-checks while waiting for a job hook to fire. Short enough
// that a test never feels it, long enough that consecutive idle passes don't
// hammer Postgres/Redis with pointless polling between hook-driven wakeups.
const DRAIN_IDLE_POLL_MS = 25;
// Two consecutive idle passes (not one) before declaring the stack drained —
// a single "pending===0 and consumers caught up" pass can be a race: a job
// hook fires and enqueues a follow-up between the countPendingJobs() read
// and the consumer check of the SAME pass. A DRAIN_IDLE_POLL_MS wait sits
// between every pass, including the first and second idle one, so an
// enqueue that lands just after the first idle read still gets picked up
// by the second pass instead of racing straight past it.
const REQUIRED_IDLE_PASSES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type JobFailureTracker = {
  readonly onJobComplete: (jobName: string, jobId: string) => void;
  readonly onJobFailed: (jobName: string, jobId: string, error: string) => void;
  waitForActivity(): Promise<void>;
  readonly failures: ReadonlyMap<string, { readonly jobName: string; readonly error: string }>;
  clear(): void;
};

export function createJobFailureTracker(): JobFailureTracker {
  const failures = new Map<string, { jobName: string; error: string }>();
  let wake: (() => void) | undefined;
  let armed: Promise<void> | undefined;

  function fire(): void {
    wake?.();
    armed = undefined;
    wake = undefined;
  }

  return {
    onJobComplete(_jobName, jobId) {
      // A retry that eventually succeeds must not leave a stale failure
      // behind from its earlier attempt(s).
      failures.delete(jobId);
      fire();
    },
    onJobFailed(jobName, jobId, error) {
      failures.set(jobId, { jobName, error });
      fire();
    },
    waitForActivity() {
      armed ??= new Promise<void>((resolve) => {
        wake = resolve;
      });
      return armed;
    },
    failures,
    clear() {
      failures.clear();
    },
  };
}

export type DrainJobsStack = {
  readonly db: DbConnection;
  readonly eventDispatcher?: EventDispatcher;
  readonly jobRunner?: JobRunner;
};

async function sharedConsumersCaughtUp(
  db: DbConnection,
  consumerNames: readonly string[],
): Promise<boolean> {
  // skip: no shared consumers wired — nothing to catch up on.
  if (consumerNames.length === 0) return true;
  const target = await getEventsHighWaterMark(db);
  let allCaughtUp = true;
  for (const name of consumerNames) {
    const state = await getConsumerState(db, name);
    if (!state) {
      throw new Error(`drainJobs: consumer "${name}" not registered or per-instance`);
    }
    if (state.status === "dead") {
      throw new Error(
        `drainJobs: consumer "${state.name}" is dead — lastError: ${state.lastError ?? "unknown"}`,
      );
    }
    if (state.lastProcessedEventId < target) allCaughtUp = false;
  }
  return allCaughtUp;
}

export async function drainJobs(stack: DrainJobsStack, tracker: JobFailureTracker): Promise<void> {
  const { db, eventDispatcher, jobRunner } = stack;
  if (!jobRunner) {
    throw new Error(
      "drainJobs: stack.jobRunner is undefined — pass `jobs: {...}` to setupTestStack and " +
        "register at least one r.job(...) so a runner is built.",
    );
  }

  const sharedConsumerNames = (eventDispatcher?.consumers ?? [])
    .filter((consumer) => (consumer.delivery ?? "shared") === "shared")
    .map((consumer) => consumer.name);

  try {
    let consecutiveIdlePasses = 0;
    while (consecutiveIdlePasses < REQUIRED_IDLE_PASSES) {
      await eventDispatcher?.runOnce();
      const pending = await jobRunner.countPendingJobs();
      const caughtUp = await sharedConsumersCaughtUp(db, sharedConsumerNames);
      consecutiveIdlePasses = pending === 0 && caughtUp ? consecutiveIdlePasses + 1 : 0;
      if (consecutiveIdlePasses < REQUIRED_IDLE_PASSES) {
        await Promise.race([tracker.waitForActivity(), sleep(DRAIN_IDLE_POLL_MS)]);
      }
    }

    if (tracker.failures.size > 0) {
      const details = [...tracker.failures.values()]
        .map((failure) => `${failure.jobName}: ${failure.error}`)
        .join("; ");
      throw new Error(`drainJobs: job(s) failed: ${details}`);
    }
  } finally {
    tracker.clear();
  }
}
