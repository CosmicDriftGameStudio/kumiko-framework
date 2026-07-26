// A forget delete-hook receives the app registry so it can cascade custom child
// projections for the executor's `<entity>.forgotten` event (runProjectionsForEvent).
// executor.forget purges only the entity's OWN projection, and the forget pipeline
// is a job — not a dispatched command — so the dispatcher's post-command projection
// pass never fires. Without registry in the hook ctx the cascade is unreachable and
// child read-model rows (m:n joins, per-parent detail projections) are orphaned on
// live forget (a DSGVO gap). This pins that the plumbing delivers the real,
// functional registry instance; the end-to-end cascade is covered consumer-side.

import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createEntity,
  createTextField,
  defineFeature,
  EXT_USER_DATA,
  type Registry,
  type UserDataDeleteHook,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { createComplianceProfilesFeature } from "../../compliance-profiles";
import { createDataRetentionFeature, tenantRetentionOverrideEntity } from "../../data-retention";
import { createSessionsFeature } from "../../sessions";
import { createUserFeature, userEntity } from "../../user";
import { createUserDataRightsFeature } from "../feature";
import { runForgetCleanup } from "../run-forget-cleanup";
import {
  createForgetSeeders,
  nowInstant,
  READ_TENANT_MEMBERSHIPS_DDL,
  TENANT_SYSTEM,
} from "./forget-test-helpers";

const PROBE = "forget-registry-probe";
let capturedRegistry: Registry | undefined;

const captureHook: UserDataDeleteHook = async (ctx) => {
  capturedRegistry = ctx.registry;
};

const probeEntity = createEntity({
  table: `read_${PROBE.replace(/-/g, "_")}`,
  fields: { name: createTextField({ required: true }) },
});

const probeFeature = defineFeature(PROBE, (r) => {
  r.entity(PROBE, probeEntity);
  r.useExtension(EXT_USER_DATA, PROBE, {
    export: async () => null,
    delete: captureHook,
  });
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
  await unsafeCreateEntityTable(stack.db, probeEntity);
  await createEventsTable(stack.db);
  await asRawClient(stack.db).unsafe(READ_TENANT_MEMBERSHIPS_DDL);
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
  // The hook ran and got the exact registry passed to runForgetCleanup — not
  // undefined, not a stand-in — so runProjectionsForEvent(event, ctx.registry, db)
  // reaches the real projections.
  expect(capturedRegistry).toBe(stack.registry);
  expect(capturedRegistry?.getProjectionsForSource(PROBE)).toBeDefined();
});
