// The forget pipeline is a job, so no dispatcher post-command pass runs projections.
// executor.forget on the hook's ctx.db must clear child read-model rows (m:n joins,
// per-parent detail projections) for `<entity>.forgotten` itself, or live forget
// orphans them (a DSGVO gap).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import {
  buildEntityTable,
  createEventStoreExecutor,
  createTenantDb,
  deleteMany,
  insertOne,
  selectMany,
  table as pgTable,
  uuid as pgUuid,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createSystemUser,
  createTextField,
  defineFeature,
  EXT_USER_DATA,
  type Registry,
  type TenantId,
  type UserDataDeleteHook,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import {
  createDataRetentionFeature,
  tenantRetentionOverrideEntity,
} from "../../data-retention/index.ts";
import { createSessionsFeature } from "../../sessions/index.ts";
import { tenantMembershipEntity } from "../../tenant/membership-table.ts";
import { createUserFeature, userEntity } from "../../user/index.ts";
import { createUserDataRightsFeature } from "../feature.ts";
import { runForgetCleanup } from "../run-forget-cleanup.ts";
import { createForgetSeeders, nowInstant, TENANT_SYSTEM } from "./forget-test-helpers.ts";

const PROBE = "forget-registry-probe";
let capturedRegistry: Registry | undefined;

const captureHook: UserDataDeleteHook = async (ctx) => {
  capturedRegistry = ctx.registry;
};

const probeEntity = createEntity({
  table: `read_${PROBE.replace(/-/g, "_")}`,
  fields: {
    name: createTextField({ required: true, personal: false, reason: "technical_reference" }),
  },
});

const probeFeature = defineFeature(PROBE, (r) => {
  r.entity({ name: PROBE, ...probeEntity });
  r.applyExtension({ name: EXT_USER_DATA, entity: PROBE, export: async () => null,
    delete: captureHook });
});

const FORGET_USER = "cccccccc-cccc-4ccc-8ccc-0000000000b1";
let stack: TestStack;
const seed = (db: unknown) =>
  // biome-ignore lint/suspicious/noExplicitAny: dummy writer; this seeder never writes binaries.
  createForgetSeeders(db as any, { write: async () => {} });

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createUserDataRightsFeature(),
      probeFeature,
    ],
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantRetentionOverrideEntity);
  await unsafeCreateEntityTable(stack.db, probeEntity);
  await unsafeCreateEntityTable(stack.db, tenantMembershipEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  capturedRegistry = undefined;
});

test("forget delete-hook receives the app registry instance", async () => {
  await seed(stack.db).seedForgetUser(FORGET_USER);
  await seed(stack.db).seedMembership(FORGET_USER, TENANT_SYSTEM);

  const result = await runForgetCleanup({
    db: stack.db,
    registry: stack.registry,
    now: nowInstant(),
  });

  expect(result.errors, JSON.stringify(result.errors)).toHaveLength(0);
  expect(result.processedUserIds).toContain(FORGET_USER);
  expect(capturedRegistry).toBe(stack.registry);
  expect(capturedRegistry?.getProjectionsForSource(PROBE)).toBeDefined();
});

const TENANT_SYSTEM_ID = TENANT_SYSTEM as TenantId;
const CASCADE = "forget-cascade-probe";

const cascadeEntity = createEntity({
  table: "read_forget_cascade_probes",
  fields: {
    name: createTextField({ required: true, personal: false, reason: "technical_reference" }),
  },
});
const cascadeTable = buildEntityTable(CASCADE, cascadeEntity);
const cascadeExecutor = createEventStoreExecutor(cascadeTable, cascadeEntity, {
  entityName: CASCADE,
});

const cascadeChildrenTable = pgTable("read_forget_cascade_children", {
  parentId: pgUuid("parent_id").primaryKey(),
  tenantId: pgUuid("tenant_id").notNull(),
});

const cascadeFeature = defineFeature("forget-cascade-host", (r) => {
  r.entity({ name: CASCADE, ...cascadeEntity });
  r.projection({
    name: "forget-cascade-children",
    source: CASCADE,
    table: cascadeChildrenTable,
    apply: {
      [`${CASCADE}.created`]: async (event, tx) => {
        await insertOne(tx, cascadeChildrenTable, {
          parentId: event.aggregateId,
          tenantId: event.tenantId,
        });
      },
      [`${CASCADE}.forgotten`]: async (event, tx) => {
        await deleteMany(tx, cascadeChildrenTable, { parentId: event.aggregateId });
      },
    },
  });
  r.applyExtension({ name: EXT_USER_DATA, entity: CASCADE, export: async () => null,
    delete: async (ctx) => {
      const rows = await ctx.db.selectMany<{ id: string }>(cascadeTable, {
        tenantId: ctx.tenantId,
      });
      for (const row of rows) {
        const res = await cascadeExecutor.forget(
          { id: row.id },
          createSystemUser(ctx.tenantId),
          ctx.db,
        );
        if (!res.isSuccess) throw new Error("forget failed");
      }
    } });
});

describe("forget hook cascade", () => {
  let cascadeStack: TestStack;

  beforeAll(async () => {
    cascadeStack = await setupTestStack({
      features: [
        createUserFeature(),
        createAuthFoundationFeature(),
        createSessionsFeature(),
        createDataRetentionFeature(),
        createComplianceProfilesFeature(),
        createUserDataRightsFeature(),
        cascadeFeature,
      ],
    });
    await unsafeCreateEntityTable(cascadeStack.db, userEntity);
    await unsafeCreateEntityTable(cascadeStack.db, tenantRetentionOverrideEntity);
    await unsafeCreateEntityTable(cascadeStack.db, cascadeEntity, CASCADE);
    await unsafeCreateEntityTable(cascadeStack.db, tenantMembershipEntity);
  });

  afterAll(async () => {
    await cascadeStack.cleanup();
  });

  test("a forget delete-hook that calls executor.forget clears the child projection without a manual cascade", async () => {
    const tenantDb = createTenantDb({ db: cascadeStack.db, tenantId: TENANT_SYSTEM_ID });
    const created = await cascadeExecutor.create(
      { name: "probe" },
      createSystemUser(TENANT_SYSTEM_ID),
      tenantDb,
    );
    expect(created.isSuccess).toBe(true);
    expect(await selectMany(cascadeStack.db, cascadeChildrenTable)).toHaveLength(1);

    await seed(cascadeStack.db).seedForgetUser(FORGET_USER);
    await seed(cascadeStack.db).seedMembership(FORGET_USER, TENANT_SYSTEM);

    const result = await runForgetCleanup({
      db: cascadeStack.db,
      registry: cascadeStack.registry,
      now: nowInstant(),
    });

    expect(result.errors, JSON.stringify(result.errors)).toHaveLength(0);
    expect(await selectMany(cascadeStack.db, cascadeTable)).toHaveLength(0);
    expect(await selectMany(cascadeStack.db, cascadeChildrenTable)).toHaveLength(0);
  });
});
