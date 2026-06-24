// Beweist dass der retention-cleanup-Cron mit perTenant-Fan-out in der
// komponierten Registry landet. Ohne perTenant feuert der Cron global einmal,
// ctx hat keinen Tenant → der Handler returnt sofort → es wird NICHTS
// bereinigt (silent no-op). r.job geht durch einen anderen Pfad als der
// synthetische soft-delete-cleanup-Job, deshalb hier explizit gepinnt.

import { describe, expect, test } from "bun:test";
import { createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import { createDataRetentionFeature } from "../feature";

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
