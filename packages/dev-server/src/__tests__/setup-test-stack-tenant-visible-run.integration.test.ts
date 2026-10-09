// setupTestStackFromFeatures wires the run-logger's onJobQueued/onJobStart/
// onJobComplete through test-stack.ts: a tenantVisibleRun job is `queued` for
// its tenant right after the HTTP write, and `completed` once drainJobs()
// returns. The queued case uses a stack without a consuming lane, so nothing
// can start the job; the completed case uses a consuming one.

import { afterEach, describe, expect, test } from "bun:test";
import { createJobsFeature, JobQueries } from "@cosmicdrift/kumiko-bundled-features/jobs";
import { defineFeature, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, type TestStack, testTenantId } from "@cosmicdrift/kumiko-framework/stack";
import * as z from "zod";
import { setupTestStackFromFeatures } from "../setup-test-stack-from-features.js";

const userA = createTestUser({ id: 1, tenantId: testTenantId(1), roles: ["Admin"] });

const appFeature = defineFeature("app", (r) => {
  r.writeHandler(
    defineWriteHandler({
      name: "generate",
      description: "Test-only: starts a tenant-visible job.",
      schema: z.object({ campaignId: z.string() }),
      access: { roles: ["Admin"] },
      handler: async (event) => ({ isSuccess: true as const, data: { ...event.payload } }),
    }),
  );
  r.job(
    "generateTexts",
    {
      trigger: { on: "app:write:generate" },
      tenantVisibleRun: { subjectFields: ["campaignId"] },
    },
    async () => {},
  );
});

type RunRow = {
  readonly status: string;
  readonly queuedAt: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
};

let stack: TestStack | undefined;

afterEach(async () => {
  await stack?.cleanup();
  stack = undefined;
});

async function runsOf(s: TestStack): Promise<RunRow[]> {
  const result = await s.http.queryOk<{ rows: RunRow[] }>(
    JobQueries.tenantRuns,
    { subject: { campaignId: "c1" } },
    userA,
  );
  return result.rows;
}

describe("setupTestStackFromFeatures({ jobs }) tenant-visible run state", () => {
  test("queued right after the write while no worker consumes", async () => {
    stack = await setupTestStackFromFeatures([appFeature, createJobsFeature()], { jobs: {} });
    await stack.http.writeOk("app:write:generate", { campaignId: "c1" }, userA);

    const rows = await runsOf(stack);
    expect(rows.map((row) => row.status)).toEqual(["queued"]);
    expect(rows[0]?.queuedAt).not.toBeNull();
    expect(rows[0]?.startedAt).toBeNull();
  });

  test("completed once drainJobs() returns", async () => {
    stack = await setupTestStackFromFeatures([appFeature, createJobsFeature()], {
      jobs: { consumerLane: "worker" },
    });
    await stack.http.writeOk("app:write:generate", { campaignId: "c1" }, userA);
    await stack.drainJobs();

    const rows = await runsOf(stack);
    expect(rows.map((row) => row.status)).toEqual(["completed"]);
    expect(rows[0]?.finishedAt).not.toBeNull();
  });
});
