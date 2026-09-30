// setupTestStackFromFeatures wires prod's job run-logger by default: a job
// declared with tenantVisibleFailure records its final failure per tenant, and
// drainJobs() only rejects after that row is written.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createJobsFeature, JobQueries } from "@cosmicdrift/kumiko-bundled-features/jobs";
import { defineFeature, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, type TestStack, testTenantId } from "@cosmicdrift/kumiko-framework/stack";
import * as z from "zod";
import { setupTestStackFromFeatures } from "../setup-test-stack-from-features.js";

const FAILURE_KEY = "app:errors.generationFailed";
const PROVIDER_MESSAGE = "provider 429: prompt with customer data rejected";

const tenantA = testTenantId(1);
const tenantB = testTenantId(2);
const userA = createTestUser({ id: 1, tenantId: tenantA, roles: ["Admin"] });
const userB = createTestUser({ id: 2, tenantId: tenantB, roles: ["Admin"] });

const appFeature = defineFeature("app", (r) => {
  r.writeHandler(
    defineWriteHandler({
      name: "generate",
      description: "Test-only: starts a job that always fails.",
      schema: z.object({ campaignId: z.string() }),
      access: { roles: ["Admin"] },
      handler: async (event) => ({ isSuccess: true as const, data: { ...event.payload } }),
    }),
  );
  r.job(
    "generateTexts",
    {
      trigger: { on: "app:write:generate" },
      retries: 0,
      tenantVisibleFailure: { messageKey: FAILURE_KEY, subjectFields: ["campaignId"] },
    },
    async () => {
      throw new Error(PROVIDER_MESSAGE);
    },
  );
});

type FailureRow = { readonly jobName: string; readonly messageKey: string };

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStackFromFeatures([appFeature, createJobsFeature()], {
    jobs: { consumerLane: "worker" },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("setupTestStackFromFeatures({ jobs }) run-logger default", () => {
  test("a failed tenant-visible job is readable by its tenant only, once drainJobs() rejects", async () => {
    await stack.http.writeOk("app:write:generate", { campaignId: "campaign-1" }, userA);

    await expect(stack.drainJobs()).rejects.toThrow(/app:job:generate-texts/);

    const own = await stack.http.queryOk<{ rows: FailureRow[] }>(JobQueries.failures, {}, userA);
    expect(own.rows).toHaveLength(1);
    expect(own.rows[0]?.jobName).toBe("app:job:generate-texts");
    expect(own.rows[0]?.messageKey).toBe(FAILURE_KEY);
    expect(JSON.stringify(own)).not.toContain(PROVIDER_MESSAGE);

    const other = await stack.http.queryOk<{ rows: FailureRow[] }>(JobQueries.failures, {}, userB);
    expect(other.rows).toHaveLength(0);
  });
});
