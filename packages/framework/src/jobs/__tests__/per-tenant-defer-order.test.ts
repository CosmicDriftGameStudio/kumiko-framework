import { describe, expect, test } from "bun:test";
import { isOverPerTenantLimit } from "../job-runner-scope.ts";

const JOB_NAME = "document-ingest:job:parse-document";
const TENANT = "tenant-b";

type ActiveJob = {
  readonly id: string;
  readonly name: string;
  readonly processedOn: number;
  readonly data: { readonly _tenantId: string };
};

function activeJob(idSuffix: string, processedOn: number, tenantId = TENANT): ActiveJob {
  return {
    id: `event.${JOB_NAME}.${idSuffix}`,
    name: JOB_NAME,
    processedOn,
    data: { _tenantId: tenantId },
  };
}

// Lists are given the way BullMQ returns its active list: most recently activated first.
function scopeWith(activeNewestFirst: {
  worker: readonly ActiveJob[];
  api?: readonly ActiveJob[];
}) {
  return {
    queues: {
      api: { getJobs: async () => activeNewestFirst.api ?? [] },
      worker: { getJobs: async () => activeNewestFirst.worker },
    },
  };
}

function defersAt(
  activeNewestFirst: { worker: readonly ActiveJob[]; api?: readonly ActiveJob[] },
  self: ActiveJob,
  limit: number,
): Promise<boolean> {
  return isOverPerTenantLimit(scopeWith(activeNewestFirst), JOB_NAME, TENANT, limit, {
    activatedBefore: { jobId: self.id },
  });
}

describe("maxPerTenant defer order", () => {
  test("a job activated in the same millisecond after a running one defers, even with the smaller id", async () => {
    const first = activeJob("24", 1000);
    const second = activeJob("16", 1000);

    expect(await defersAt({ worker: [first] }, first, 1)).toBe(false);
    expect(await defersAt({ worker: [second, first] }, second, 1)).toBe(true);
  });

  test("a job activated later by a worker whose clock lags behind defers", async () => {
    const first = activeJob("1", 2000);
    const laterOnSlowClock = activeJob("2", 1000);

    expect(await defersAt({ worker: [first] }, first, 1)).toBe(false);
    expect(await defersAt({ worker: [laterOnSlowClock, first] }, laterOnSlowClock, 1)).toBe(true);
  });

  test("of a burst activated together, exactly the first `limit` jobs run", async () => {
    const burst = [
      activeJob("a", 1000),
      activeJob("b", 1000),
      activeJob("c", 1000),
      activeJob("d", 1000),
    ];
    const activeNewestFirst = { worker: [...burst].reverse() };

    const limitOne = await Promise.all(burst.map((job) => defersAt(activeNewestFirst, job, 1)));
    expect(limitOne).toEqual([false, true, true, true]);

    const limitTwo = await Promise.all(burst.map((job) => defersAt(activeNewestFirst, job, 2)));
    expect(limitTwo).toEqual([false, false, true, true]);
  });

  test("jobs of other tenants or other job names never count", async () => {
    const self = activeJob("2", 1000);
    const otherTenant = activeJob("1", 900, "tenant-a");
    const otherName = { ...activeJob("0", 900), name: "document-ingest:job:other" };

    expect(await defersAt({ worker: [self, otherTenant, otherName] }, self, 1)).toBe(false);
  });

  test("an active job of the same tenant in the other lane queue always counts", async () => {
    const self = activeJob("1", 1000);
    const inOtherLane = activeJob("2", 5000);

    expect(await defersAt({ worker: [self], api: [inOtherLane] }, self, 1)).toBe(true);
  });
});
