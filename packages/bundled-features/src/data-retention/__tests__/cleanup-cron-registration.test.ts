// Proves that the retention-cleanup cron with perTenant fan-out reaches the
// composed registry. Without perTenant, the cron fires globally once; ctx has no
// tenant, so the handler returns immediately and cleans up NOTHING (silent no-op).
// r.job follows a different path from the synthetic soft-delete-cleanup job, so
// it is pinned explicitly here.

import { describe, expect, test } from "bun:test";
import { createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import { createDataRetentionFeature } from "../feature.ts";

const RETENTION_CLEANUP_JOB = "data-retention:job:retention-cleanup";

describe("retention-cleanup cron registration", () => {
  test("perTenant + daily trigger + skip-concurrency ueberleben die Komposition", () => {
    const registry = createRegistry([createDataRetentionFeature()]);
    const job = registry.getJob(RETENTION_CLEANUP_JOB);

    expect(job).toBeDefined();
    expect(job?.perTenant).toBe(true);
    expect(job?.trigger).toEqual({ cron: "0 3 * * *" });
    expect(job?.concurrency).toBe("skip");
  });
});
