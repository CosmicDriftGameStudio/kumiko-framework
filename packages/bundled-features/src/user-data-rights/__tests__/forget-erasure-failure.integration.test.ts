// A forget hook that cannot erase a row (anything but `not_found`) must make
// the erasure fail visibly: runForgetCleanup reports the error, the user stays
// DeletionRequested and the row survives. Before collectErasureFailure /
// throwIfErasureFailed existed, hooks dropped the executor's failure result and
// the user flipped to Deleted with the row still in place.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { asRawClient, fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  buildEntityTable,
  createEventStoreExecutor,
  createTenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createSystemUser,
  createTextField,
  defineFeature,
  EXT_USER_DATA,
  type TenantId,
  type UserDataDeleteHook,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.js";
import {
  createDataRetentionFeature,
  tenantRetentionOverrideEntity,
} from "../../data-retention/index.js";
import { createSessionsFeature } from "../../sessions/index.js";
import { collectErasureFailure, throwIfErasureFailed } from "../../shared/index.js";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user/index.js";
import { createUserDataRightsFeature } from "../feature.js";
import { runForgetCleanup } from "../run-forget-cleanup.js";
import {
  createForgetSeeders,
  nowInstant,
  READ_TENANT_MEMBERSHIPS_DDL,
} from "./forget-test-helpers.js";

const TENANT = "00000000-0000-4000-8000-0000000000bb" as TenantId;
const FORGET_USER = "cccccccc-cccc-4ccc-8ccc-0000000000b1";
const PROBE_ENTITY = "erasure-probe";
const PROBE_TABLE = "read_erasure_probes";

// Only the Curator role may write a probe row, so the hook's non-curator user is
// refused (framework system users bypass the write ownership check) with ownership_denied when it tries to forget one.
const probeEntity = createEntity({
  table: PROBE_TABLE,
  access: { write: { Curator: "all" } },
  fields: {
    label: createTextField({ required: true, personal: false, reason: "technical_reference" }),
  },
});

const probeTable = buildEntityTable(PROBE_ENTITY, probeEntity);
const probeCrud = createEventStoreExecutor(probeTable, probeEntity, { entityName: PROBE_ENTITY });

const probeDeleteHook: UserDataDeleteHook = async (ctx) => {
  const rows = await ctx.db.selectMany<Record<string, unknown>>(probeTable, {
    tenantId: ctx.tenantId,
  });
  const nonCurator = createTestUser({ tenantId: ctx.tenantId, roles: ["Member"] });
  const failures: string[] = [];
  for (const row of rows) {
    const id = row["id"]; // @cast-boundary db-row
    if (typeof id !== "string") continue;
    collectErasureFailure(
      await probeCrud.forget({ id }, nonCurator, ctx.db),
      PROBE_ENTITY,
      id,
      failures,
    );
  }
  throwIfErasureFailed(failures);
};

const probeFeature = defineFeature("erasure-probe-host", (r) => {
  r.entity(PROBE_ENTITY, probeEntity);
  r.useExtension(EXT_USER_DATA, PROBE_ENTITY, {
    export: async () => null,
    delete: probeDeleteHook,
    escapeHatch: {
      reason:
        "test fixture: probes the erasure-failure contract with a hook that forgets through the executor",
    },
  });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      authFoundationFeature,
      createSessionsFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createUserDataRightsFeature(),
      probeFeature,
    ],
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantRetentionOverrideEntity);
  await unsafeCreateEntityTable(stack.db, probeEntity, PROBE_ENTITY);
  await asRawClient(stack.db).unsafe(READ_TENANT_MEMBERSHIPS_DDL);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetEventStore(stack);
  await asRawClient(stack.db).unsafe(`DELETE FROM ${PROBE_TABLE}`);
  await asRawClient(stack.db).unsafe(`DELETE FROM read_tenant_retention_overrides`);
  await asRawClient(stack.db).unsafe(`DELETE FROM read_tenant_memberships`);
});

async function seedProbeRow(): Promise<string> {
  const curator = { ...createSystemUser(TENANT), roles: ["Curator"] };
  const result = await probeCrud.create(
    { label: "must be erased" },
    curator,
    createTenantDb(stack.db, TENANT, "system"),
  );
  if (!result.isSuccess) throw new Error(`seedProbeRow failed: ${result.error.message}`);
  return String(result.data.id);
}

describe("forget erasure failure :: a hook that cannot erase a row fails the erasure visibly", () => {
  test("ownership_denied on forget keeps the user DeletionRequested, keeps the row and surfaces the error", async () => {
    const seed = createForgetSeeders(stack.db, { write: async () => {} });
    await seed.seedForgetUser(FORGET_USER);
    await seed.seedMembership(FORGET_USER, TENANT);
    const rowId = await seedProbeRow();

    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: nowInstant(),
    });

    expect(result.processedUserIds).not.toContain(FORGET_USER);
    const error = result.errors.find(
      (e) => e.userId === FORGET_USER && e.entityName === PROBE_ENTITY,
    );
    expect(error?.message).toContain(`${PROBE_ENTITY}/${rowId}`);
    expect(error?.message).toContain("ownership_denied");

    const rows = await asRawClient(stack.db).unsafe(`SELECT id FROM ${PROBE_TABLE}`);
    expect(rows as ReadonlyArray<unknown>).toHaveLength(1);
    const user = await fetchOne<{ status: string }>(stack.db, userTable, { id: FORGET_USER });
    expect(user?.status).toBe(USER_STATUS.DeletionRequested);
  });
});
