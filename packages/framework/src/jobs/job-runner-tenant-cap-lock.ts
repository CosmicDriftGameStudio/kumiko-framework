import type { JobRunnerScope } from "./job-runner-scope.ts";

const CAP_LOCK_TTL_SEC = 10;
const CAP_LOCK_POLL_MS = 15;
const CAP_LOCK_MAX_WAIT_MS = 3_000;

const releaseNothing = async (): Promise<void> => {};

// Count-then-add is two steps; holding this lock across both makes the "skip" cap exact for
// every dispatcher sharing the Redis. The lock only guards the short check+add window, so a
// holder that crashes frees it via the TTL. A lock that stays contended past the wait budget
// degrades to the soft cap instead of failing the dispatch.
export async function acquireTenantCapLock(
  scope: JobRunnerScope,
  jobName: string,
  tenantId: string,
): Promise<() => Promise<void>> {
  const { tenantCapLock } = scope;
  if (!tenantCapLock) return releaseNothing;
  const key = `${jobName}:${tenantId}`;
  const deadline = Date.now() + CAP_LOCK_MAX_WAIT_MS;
  for (;;) {
    const token = await tenantCapLock.acquire(key, { ttlSeconds: CAP_LOCK_TTL_SEC });
    if (token) {
      return async () => {
        await tenantCapLock.release(key, token);
      };
    }
    if (Date.now() >= deadline) {
      scope.errorLogger.warn("maxPerTenant lock stayed contended, enforcing the cap softly", {
        job: jobName,
      });
      return releaseNothing;
    }
    await new Promise((resolve) => setTimeout(resolve, CAP_LOCK_POLL_MS));
  }
}
