// Forget cleanup of a user erases the record key of rows the user owns through
// personal { of, whenAbsent: "self" } fields: the created event of such a row still holds
// ciphertext under that key.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { KeyErasedError } from "@cosmicdrift/kumiko-framework/crypto";
import {
  createEntity,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createFilesFeature, fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import {
  createDataRetentionFeature,
  tenantRetentionOverrideEntity,
} from "../../data-retention/index.ts";
import { createSessionsFeature, userSessionEntity } from "../../sessions/index.ts";
import { tenantMembershipEntity } from "../../tenant/membership-table.ts";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user/index.ts";
import { seedUser as seedUserViaExecutor } from "../../user/seeding.ts";
import { createUserDataRightsDefaultsFeature } from "../../user-data-rights-defaults/index.ts";
import { createUserDataRightsFeature } from "../feature.ts";
import { updateUserLifecycle } from "../lib/update-user-lifecycle.ts";
import { runForgetCleanup } from "../run-forget-cleanup.ts";
import { setupSubjectKmsForTest } from "./forget-shredding-test-helpers.ts";

const FEATURE = "forget-cleanup-record-probe";
const CREATE = `${FEATURE}:write:slip:create`;
const UPDATE = `${FEATURE}:write:slip:update`;

const slipEntity = createEntity({
  name: "slip",
  table: "read_forget_cleanup_record_slips",
  fields: {
    ownerId: createTextField({ personal: "ref" }),
    name: createTextField({ personal: { of: "ownerId", whenAbsent: "self" }, find: "none" }),
  },
});

const probeFeature = defineFeature(FEATURE, (r) => {
  r.entity(slipEntity);
  r.crud(slipEntity, {
    write: { access: { roles: ["SystemAdmin"] } },
    read: { access: { roles: ["SystemAdmin"] } },
  });
});

let stack: TestStack;
const getKms = setupSubjectKmsForTest();

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      createFilesFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createUserDataRightsFeature(),
      createUserDataRightsDefaultsFeature(),
      probeFeature,
    ],
    jobs: { consumerLane: "worker" },
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafeCreateEntityTable(stack.db, tenantRetentionOverrideEntity);
  await unsafeCreateEntityTable(stack.db, tenantMembershipEntity);
  await unsafeCreateEntityTable(stack.db, slipEntity, "slip");
  await unsafePushTables(stack.db, { fileRefsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [
    userTable,
    "read_tenant_memberships",
    "read_forget_cleanup_record_slips",
    fileRefsTable,
    eventsTable,
  ]);
});

describe("runForgetCleanup :: rows owned through whenAbsent self", () => {
  test("erases the record key that sealed the row's ownerless phase", async () => {
    const { id: userId } = await seedUserViaExecutor(stack.db, {
      email: "owner@example.com",
      displayName: "Owner",
      passwordHash: "hashed",
      emailVerified: true,
    });
    const { id } = await stack.http.writeOk<{ id: string }>(
      CREATE,
      { name: "early" },
      TestUsers.systemAdmin,
    );
    await stack.http.writeOk(
      UPDATE,
      { id, version: 1, changes: { ownerId: userId } },
      TestUsers.systemAdmin,
    );
    const recordSubject = { kind: "record" as const, entity: "slip", id };
    await getKms().getKey(recordSubject);

    await updateUserLifecycle(stack.db, userId, {
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd: getTemporal().Instant.fromEpochMilliseconds(Date.now() - 60 * 1000),
    });
    const result = await runForgetCleanup({
      db: stack.db,
      registry: stack.registry,
      now: getTemporal().Now.instant(),
    });

    expect(result.errors).toEqual([]);
    expect(result.processedUserIds).toContain(userId);
    await expect(getKms().getKey(recordSubject)).rejects.toBeInstanceOf(KeyErasedError);
  });
});
