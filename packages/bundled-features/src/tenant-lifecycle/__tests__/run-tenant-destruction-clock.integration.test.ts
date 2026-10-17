// The run-tenant-destruction cron judges "due" by ctx.tz.now(), so a test advances an injected
// clock past the grace period instead of patching Temporal.Now.

import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  createManualClock,
  createTestEnvelopeCipher,
  resetTestTables,
} from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileTable,
} from "../../compliance-profiles/index.js";
import { createConfigFeature } from "../../config/index.js";
import { createConfigResolver } from "../../config/resolver.js";
import { createSessionsFeature } from "../../sessions/index.js";
import { userSessionTable } from "../../sessions/schema/user-session.js";
import { TenantHandlers } from "../../tenant/constants.js";
import { createTenantFeature } from "../../tenant/feature.js";
import { tenantTable } from "../../tenant/schema/tenant.js";
import { createUserFeature } from "../../user/feature.js";
import { createTenantLifecycleFeature, TenantLifecycleHandlers } from "../index.js";
import { resetTenantLifecycleGateCacheForTests } from "../lifecycle-gate.js";

const JOB = "tenant-lifecycle:job:run-tenant-destruction";
const SET_PROFILE = "compliance-profiles:write:set-profile";
const tenantAdmin = TestUsers.admin;
const clock = createManualClock(getTemporal().Now.instant());

let stack: TestStack;

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      authFoundationFeature,
      createSessionsFeature(),
      createTenantLifecycleFeature(),
    ],
    extraContext: {
      configResolver: createConfigResolver({ cipher: encryption }),
      configEncryption: encryption,
      clock,
    },
    jobs: { consumerLane: "worker" },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  resetTenantLifecycleGateCacheForTests();
  await resetTestTables(stack.db, [
    tenantTable,
    tenantComplianceProfileTable,
    userSessionTable,
    eventsTable,
  ]);
});

async function tenantStatus(): Promise<string> {
  const [row] = await selectMany(stack.db, tenantTable, { id: tenantAdmin.tenantId });
  return String(row?.["status"]);
}

test("the cron job destroys a tenant once the injected clock passes its grace period", async () => {
  await stack.http.writeOk(
    TenantHandlers.create,
    { id: tenantAdmin.tenantId, key: "acme", name: "ACME Corp" },
    TestUsers.systemAdmin,
  );
  await stack.http.writeOk(SET_PROFILE, { profileKey: "eu-dsgvo" }, tenantAdmin);
  await stack.http.writeOk(TenantLifecycleHandlers.requestDestruction, {}, tenantAdmin);

  await stack.jobRunner?.dispatch(JOB, {});
  await stack.drainJobs();
  expect(await tenantStatus()).toBe("destroyRequested");

  clock.advance({ hours: 24 * 3650 });
  let status = "";
  for (let tick = 0; tick < 20 && status !== "destroyed" && status !== "destroyFailed"; tick++) {
    await stack.jobRunner?.dispatch(JOB, {});
    await stack.drainJobs();
    status = await tenantStatus();
  }

  expect(status).toBe("destroyed");
});
