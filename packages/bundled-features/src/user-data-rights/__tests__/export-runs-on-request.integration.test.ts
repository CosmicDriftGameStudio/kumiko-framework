// The export runs on the committed request-export (r.job "run-requested-export", on-trigger),
// without waiting for the daily maintenance run. No mail features are mounted: only the
// job's own pipeline (claim, bundle, in-memory storage, done) is under test.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  resetTestTables,
  seedRowViaEventStore,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.ts";
import { createConfigAccessorFactory } from "../../config/feature.ts";
import {
  configValuesTable,
  createConfigFeature,
  createConfigResolver,
} from "../../config/index.ts";
import { createDataRetentionFeature } from "../../data-retention/index.ts";
import { createFileFoundationFeature } from "../../file-foundation/index.ts";
import { createFileProviderInMemoryFeature } from "../../file-provider-inmemory/index.ts";
import { createSessionsFeature } from "../../sessions/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantMembershipEntity, tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user/index.ts";
import { createUserDataRightsFeature } from "../feature.ts";
import { exportDownloadTokenEntity } from "../schema/download-token.ts";
import { EXPORT_JOB_STATUS, exportJobEntity, exportJobsTable } from "../schema/export-job.ts";
import { UserDataRightsHandlers } from "../web/constants.ts";

const TENANT = "00000000-0000-4000-8000-0000000009c1";
const USER_ID = "00000000-0000-4000-8000-0000000009d1";

const configResolver = createConfigResolver({
  appOverrides: new Map([["file-foundation:config:provider", "inmemory"]]),
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createUserFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createFileFoundationFeature(),
      createFileProviderInMemoryFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createUserDataRightsFeature(),
    ],
    extraContext: (deps) => ({
      configResolver,
      configAccessorFactory: createConfigAccessorFactory(deps.registry, configResolver),
    }),
    jobs: { consumerLane: "worker" },
  });
  await unsafePushTables(stack.db, { configValuesTable });
  await unsafeCreateEntityTable(stack.db, exportJobEntity);
  await unsafeCreateEntityTable(stack.db, exportDownloadTokenEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantMembershipEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [
    exportJobsTable,
    userTable,
    tenantMembershipsTable,
    eventsTable,
  ]);
  await seedRowViaEventStore(stack.db, userTable, {
    id: USER_ID,
    email: "export-on-request@example.test",
    passwordHash: "hashed",
    displayName: "On Request Export",
    locale: "en",
    emailVerified: true,
    roles: '["Member"]',
    status: USER_STATUS.Active,
  });
  await seedRowViaEventStore(stack.db, tenantMembershipsTable, {
    tenantId: TENANT,
    userId: USER_ID,
    roles: '["Member"]',
  });
});

describe("export runs on request", () => {
  test("request-export runs the export right after the request, without the maintenance run", async () => {
    const { jobId } = await stack.http.writeOk<{ jobId: string }>(
      UserDataRightsHandlers.requestExport,
      {},
      { id: USER_ID, tenantId: TENANT, roles: ["Member"] },
    );
    await stack.drainJobs();

    const [job] = await selectMany<{ status: string }>(stack.db, exportJobsTable, { id: jobId });
    expect(job?.status).toBe(EXPORT_JOB_STATUS.Done);
  });
});
