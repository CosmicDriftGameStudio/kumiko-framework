// export-job-list/detail :: SystemAdmin cross-tenant visibility.
//
// Regression: the changeset describes these as "a platform-operator
// inspector over the GDPR read-models" (i.e. cross-tenant), but the handlers
// registered no crossTenant/systemScope override — a SystemAdmin acting in
// tenant A saw only tenant A's export jobs, never tenant B's.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { createEventsTable, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import { createComplianceProfilesFeature } from "../../compliance-profiles";
import { createDataRetentionFeature } from "../../data-retention";
import { createSessionsFeature } from "../../sessions";
import { createUserFeature } from "../../user";
import { createUserDataRightsFeature } from "../feature";
import { exportJobEntity, exportJobsTable } from "../schema/export-job";

const REQUEST_EXPORT = "user-data-rights:write:request-export";
const EXPORT_JOB_LIST = "user-data-rights:query:export-job:list";
const EXPORT_JOB_DETAIL = "user-data-rights:query:export-job:detail";

let stack: TestStack;

const tenantA = testTenantId(1);
const tenantB = testTenantId(2);
const aliceInA = createTestUser({ id: 42, tenantId: tenantA, roles: ["Member"] });
const bobInB = createTestUser({ id: 43, tenantId: tenantB, roles: ["Member"] });
const sysadminInA = createTestUser({ id: 1, tenantId: tenantA, roles: ["SystemAdmin"] });

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      authFoundationFeature,
      createSessionsFeature(),
      createUserDataRightsFeature(),
    ],
  });
  await unsafeCreateEntityTable(stack.db, exportJobEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [exportJobsTable, eventsTable]);
});

describe("export-job list/detail :: SystemAdmin sees every tenant's jobs", () => {
  test("list includes jobs from a tenant the SystemAdmin isn't acting in", async () => {
    const aJob = await stack.http.writeOk<{ jobId: string }>(REQUEST_EXPORT, {}, aliceInA);
    const bJob = await stack.http.writeOk<{ jobId: string }>(REQUEST_EXPORT, {}, bobInB);

    const result = await stack.http.queryOk<{ rows: Array<{ id: string }> }>(
      EXPORT_JOB_LIST,
      {},
      sysadminInA,
    );
    const ids = result.rows.map((r) => r.id);
    expect(ids).toContain(aJob.jobId);
    expect(ids).toContain(bJob.jobId);
  });

  test("detail resolves a job that belongs to a different tenant than the caller", async () => {
    const bJob = await stack.http.writeOk<{ jobId: string }>(REQUEST_EXPORT, {}, bobInB);

    const detail = await stack.http.queryOk<{ id: string } | null>(
      EXPORT_JOB_DETAIL,
      { id: bJob.jobId },
      sysadminInA,
    );
    expect(detail?.id).toBe(bJob.jobId);
  });
});
