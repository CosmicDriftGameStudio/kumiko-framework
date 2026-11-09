import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable, loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { createTestEnvelopeCipher, resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileTable,
} from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { createSessionsFeature } from "../../sessions/index.ts";
import { userSessionTable } from "../../sessions/schema/user-session.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantMembershipsTable } from "../../tenant/index.ts";
import { tenantTable } from "../../tenant/schema/tenant.ts";
import { TenantHandlers } from "../../tenant/web/constants.ts";
import { createUserFeature } from "../../user/feature.ts";
import {
  TENANT_DESTRUCTION_FAILED_EVENT_QN,
  TENANT_DESTRUCTION_STAGE_ABANDONED_EVENT_QN,
  TENANT_DESTRUCTION_STAGE_FAILED_EVENT_QN,
  TENANT_DESTRUCTION_STARTED_EVENT_QN,
} from "../constants.ts";
import { createTenantLifecycleFeature, TenantLifecycleHandlers } from "../index.ts";
import { resetTenantLifecycleGateCacheForTests } from "../lifecycle-gate.ts";
import { runTenantDestructionSweep } from "../run-tenant-destroy.ts";

const SET_PROFILE = "compliance-profiles:write:set-profile";
const PARALLEL_SWEEPS = 4;
const MAX_ROUNDS = 20;

let stack: TestStack;
let db: DbConnection;
const tenantAdmin = TestUsers.admin;

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createTenantLifecycleFeature(),
    ],
    extraContext: {
      configResolver: createConfigResolver({ cipher: encryption }),
      configEncryption: encryption,
    },
  });
  db = stack.db;
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  resetTenantLifecycleGateCacheForTests();
  await resetTestTables(db, [
    tenantTable,
    tenantComplianceProfileTable,
    userSessionTable,
    tenantMembershipsTable,
    eventsTable,
  ]);
});

describe("tenant-lifecycle :: overlapping destruction sweeps", () => {
  test("parallel sweeps on one tenant never push it into destroyFailed", async () => {
    await stack.http.writeOk(
      TenantHandlers.create,
      { id: tenantAdmin.tenantId, key: "acme", name: "ACME Corp" },
      TestUsers.systemAdmin,
    );
    await stack.http.writeOk(SET_PROFILE, { profileKey: "eu-dsgvo" }, tenantAdmin);
    await stack.http.writeOk(TenantLifecycleHandlers.requestDestruction, {}, tenantAdmin);

    const farFuture = getTemporal()
      .Now.instant()
      .add({ hours: 24 * 3650 });

    let status = "";
    for (let round = 0; round < MAX_ROUNDS; round++) {
      await Promise.all(
        Array.from({ length: PARALLEL_SWEEPS }, () =>
          runTenantDestructionSweep({ db: stack.db, registry: stack.registry, now: farFuture }),
        ),
      );
      const rows = await selectMany(db, tenantTable, { id: tenantAdmin.tenantId });
      status = String(rows[0]?.["status"]);
      if (status === "destroyed" || status === "destroyFailed") break;
    }

    const eventTypes = (await loadAggregate(db, tenantAdmin.tenantId, SYSTEM_TENANT_ID)).map(
      (event) => event.type,
    );
    expect(eventTypes).not.toContain(TENANT_DESTRUCTION_STAGE_FAILED_EVENT_QN);
    expect(eventTypes).not.toContain(TENANT_DESTRUCTION_STAGE_ABANDONED_EVENT_QN);
    expect(eventTypes).not.toContain(TENANT_DESTRUCTION_FAILED_EVENT_QN);
    expect(eventTypes.filter((type) => type === TENANT_DESTRUCTION_STARTED_EVENT_QN)).toHaveLength(
      1,
    );
    expect(status).toBe("destroyed");
  });
});
