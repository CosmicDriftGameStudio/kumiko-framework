import type { Queue } from "bullmq";
import type { JobRunIn } from "../engine/types/index.ts";

// Queue-name convention: <prefix>-<lane>. The prefix is fixed in prod
// ("kumiko-jobs") — it must match between enqueuers and consumers, and an
// accidental drift would silently drop jobs. Tests override via
// `queueNamePrefix` for per-run isolation (stale jobs from a prior run
// don't leak into a new test because the queue name includes a timestamp).
export const DEFAULT_QUEUE_NAME_PREFIX = "kumiko-jobs";

export function queueNameFor(prefix: string, lane: JobRunIn): string {
  return `${prefix}-${lane}`;
}

// perTenant jobs need a source of truth for "which tenants are active" —
// see createJobRunner's defaultGetActiveTenantIds below. The tenant feature
// (bundled-features package) registers a query under this exact name when
// mounted. framework must not depend on bundled-features (wrong direction —
// bundled-features already depends on framework), so this is a name-only
// coupling: createJobRunner looks the handler up in the registry by string
// instead of importing it.
export const ACTIVE_TENANT_IDS_QUERY_NAME = "tenant:query:active-tenant-ids";

/**
 * BullMQ job ids are `repeat:<schedulerId>:<millis>`. Colons inside the
 * scheduler id push the segment count to ≥5, which BullMQ's legacy heuristic
 * treated as old repeatables — spawning a new scheduler entry every tick and
 * leaking permanent `repeat:*` hashes (taskforcesh/bullmq#3828, fw#1603 /
 * publicstatus Redis OOM). Strip `.` and `:` from the job QN.
 */
export function schedulerIdForJobName(jobName: string): string {
  return `scheduler-${jobName.replace(/[.:]/g, "-")}`;
}

// Same colon-in-BullMQ-id hazard as schedulerIdForJobName (fw#1603/#1604) —
// a QN like "publicstatus:job:uptime-probe" must not leave ":" in the id.
export function bootJobIdForJobName(jobName: string): string {
  return `boot-${jobName.replace(/[.:]/g, "-")}`;
}

const SCHEDULER_PAGE_SIZE = 100;

// Rolling deploys run old and new pods against the same Redis for a while; an
// old runner restarting in that window must not delete the scheduler of a
// cron job the new version just added.
export const ORPHAN_SCHEDULER_GRACE_MS = 60 * 60 * 1000;

function schedulerSeenKey(queue: Queue): string {
  return queue.toKey("kumiko-scheduler-seen");
}

// "Seen" has to mean a live runner holds the scheduler, so runners re-stamp
// their own ids periodically; a single stamp at start() would let a runner
// restarting during a mixed-version window longer than the grace period delete
// a scheduler a healthy newer pod still owns.
export async function markSchedulersSeen(
  queue: Queue,
  schedulerIds: ReadonlySet<string>,
): Promise<void> {
  // skip: no cron scheduler on this lane, nothing to stamp
  if (schedulerIds.size === 0) return;
  const stamp = String(Date.now());
  const entries = Object.fromEntries([...schedulerIds].map((id) => [id, stamp]));
  await (await queue.client).hset(schedulerSeenKey(queue), entries);
}

type OrphanSchedulerLog = {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
};

// A cron job dropped from the app (or an older scheduler-id format) leaves its
// scheduler in Redis, where it keeps firing jobs the worker no longer knows
// ("Unknown job"). Best-effort: a Redis hiccup here must not stop the start.
export async function removeOrphanJobSchedulers(
  queue: Queue,
  expectedSchedulerIds: ReadonlySet<string>,
  lane: JobRunIn,
  log: OrphanSchedulerLog,
): Promise<void> {
  try {
    // Collect first: removing while paging would shift the indices.
    const existingKeys: string[] = [];
    for (let start = 0; ; start += SCHEDULER_PAGE_SIZE) {
      const page = await queue.getJobSchedulers(start, start + SCHEDULER_PAGE_SIZE - 1);
      for (const scheduler of page) existingKeys.push(scheduler.key);
      if (page.length < SCHEDULER_PAGE_SIZE) break;
    }
    const client = await queue.client;
    const seenAt = await client.hgetall(schedulerSeenKey(queue));
    const now = Date.now();
    for (const key of existingKeys) {
      if (expectedSchedulerIds.has(key)) continue;
      const lastSeen = Number(seenAt[key]);
      if (key in seenAt && now - lastSeen < ORPHAN_SCHEDULER_GRACE_MS) continue;
      await queue.removeJobScheduler(key);
      await client.hdel(schedulerSeenKey(queue), key);
      log.info("removed orphan job scheduler", { schedulerId: key, lane });
    }
  } catch (err) {
    log.warn("orphan job scheduler cleanup failed", {
      lane,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Deterministic per-tenant child job id, derived from the perTenant
// wrapper's own BullMQ job id. A cron tick's wrapper id is
// `repeat:<schedulerId>:<millis>` (stable for that tick, including across
// BullMQ's own retry/stalled-job redelivery of the *same* job); a manual
// dispatch's wrapper id is BullMQ's auto-generated id, equally stable
// across retries of that job. Reusing it means a wrapper that runs twice
// for the same trigger (retry after failure, a Redis drop, an instance
// restarting mid-run) re-derives the *same* child ids, and BullMQ's
// existing-jobId add() no-ops the second batch instead of creating
// duplicates — safe only as long as the child job hash outlives the
// wrapper's retry window, enforced at construction against
// COMPLETED_JOB_RETENTION_AGE_SEC (see the invariant check in
// createJobRunner). Same colon-in-BullMQ-id hazard as schedulerIdForJobName
// (fw#1603/#1604) — the wrapper id already contains ":", so strip
// separators from both halves before joining instead of interpolating raw.
export function perTenantChildJobId(wrapperJobId: string, tenantId: string): string {
  const sanitize = (value: string) => value.replace(/[.:]/g, "-");
  return `child-${sanitize(wrapperJobId)}-${sanitize(tenantId)}`;
}
