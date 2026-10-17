import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import {
  createEventStoreExecutor,
  createTenantDb,
  fetchOne,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createRegistry,
  createSystemUser,
  type Registry,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createProjectionStateTable,
  rebuildProjection,
} from "@cosmicdrift/kumiko-framework/pipeline";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { authFoundationFeature } from "../../auth-foundation/index.js";
import { createConfigFeature } from "../../config/index.js";
import { createPersonalAccessTokensFeature } from "../../personal-access-tokens/feature.js";
import { apiTokenEntity } from "../../personal-access-tokens/schema/api-token.js";
import { createTenantFeature } from "../../tenant/index.js";
import { tenantInvitationEntity } from "../../tenant/invitation-table.js";
import { tenantMembershipsTable } from "../../tenant/membership-table.js";
import { seedTenantMembership } from "../../tenant/seeding.js";
import { createUserFeature } from "../../user/feature.js";
import { USER_STATUS, userEntity, userTable } from "../../user/index.js";
import { principalStatusPlugin } from "../../user/principal-status.js";
import { seedUser } from "../../user/seeding.js";
import { createCryptoShreddingFeature } from "../feature.js";

const FORGET = "crypto-shredding:write:forget-subject";
const TENANT: TenantId = testTenantId(1);
const REASON = "authority request #3817 (Art. 17)";
const dpoUser = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-0000000000d1",
  tenantId: TENANT,
  roles: ["DataProtectionOfficer"],
};

let stack: TestStack;
let registry: Registry;
const USER_PROJECTION = "user:projection:user-entity";
const userExecutor = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });

function buildFeatures() {
  return [
    createCryptoShreddingFeature(),
    createUserFeature(),
    createTenantFeature(),
    createConfigFeature(),
    authFoundationFeature,
    createPersonalAccessTokensFeature({ scopes: {} }),
  ];
}

beforeAll(async () => {
  stack = await setupTestStack({ features: buildFeatures() });
  registry = createRegistry(buildFeatures());
  await createProjectionStateTable(stack.db);
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, apiTokenEntity);
  await unsafeCreateEntityTable(stack.db, tenantInvitationEntity);
  await unsafePushTables(stack.db, { tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
  resetBlindIndexKeyForTests();
});

async function userRow(userId: string) {
  const row = await fetchOne<Record<string, unknown>>(stack.db, userTable, { id: userId });
  return { status: row?.["status"], isDeleted: row?.["isDeleted"] };
}

describe("forget-subject for a user whose stream is deleted but whose status is still active (#3817)", () => {
  test("closes the login door via a user.updated event and survives a read_users rebuild", async () => {
    const kms = new InMemoryKmsAdapter();
    configurePiiSubjectKms(kms);
    const { id } = await seedUser(stack.db, { email: "stale-a@example.com", displayName: "A" });
    const deleted = await userExecutor.delete(
      { id },
      createSystemUser(SYSTEM_TENANT_ID),
      createTenantDb({ db: stack.db, tenantId: SYSTEM_TENANT_ID, mode: "system" }),
    );
    expect(deleted.isSuccess).toBe(true);
    expect(await userRow(id)).toEqual({ status: USER_STATUS.Active, isDeleted: true });

    await seedTenantMembership(stack.db, { userId: id, tenantId: TENANT, roles: ["Member"] });
    const res = await stack.http.write(
      FORGET,
      { subject: { kind: "user", userId: id }, reason: REASON },
      dpoUser,
    );
    expect(res.status).toBe(200);
    await expect(kms.getKey({ kind: "user", userId: id })).rejects.toThrow("Subject key erased");

    expect(await userRow(id)).toEqual({ status: USER_STATUS.Deleted, isDeleted: true });
    expect(await principalStatusPlugin.resolveStatus(id, { db: stack.db })).toBe("blocked");

    await rebuildProjection(USER_PROJECTION, { db: stack.db, registry });
    expect(await userRow(id)).toEqual({ status: USER_STATUS.Deleted, isDeleted: true });
    expect(await principalStatusPlugin.resolveStatus(id, { db: stack.db })).toBe("blocked");
  });
});
