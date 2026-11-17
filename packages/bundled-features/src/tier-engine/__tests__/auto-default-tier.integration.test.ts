import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { SYSTEM_USER_ID } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  createTestEnvelopeCipher,
  resetPiiSubjectKmsForTests,
  resetTestTables,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant.ts";
import { TenantHandlers } from "../../tenant/web/constants.ts";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity, userTable } from "../../user/schema/user.ts";
import { tierAssignmentEntity } from "../entity.ts";
import { createTierEngineFeature } from "../feature.ts";
import { tierAssignmentTable } from "../table.ts";
import { TierAssignmentSources, TierEngineQueries } from "../web/constants.ts";

const creator = { ...TestUsers.systemAdmin, tenantId: testTenantId(7) };

type TenantTier = {
  tier: string;
  source: string;
  tenantId: string;
  insertedById: string | null;
} | null;

let stack: TestStack;

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createTierEngineFeature({
        tierMap: { free: { features: [], caps: { maxItems: 1 } } },
        defaultTier: "free",
      }),
    ],
    extraContext: {
      configResolver: createConfigResolver({ cipher: encryption }),
      configEncryption: encryption,
    },
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tierAssignmentEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

beforeEach(async () => {
  await resetTestTables(stack.db, [
    userTable,
    tenantMembershipsTable,
    tenantTable,
    tierAssignmentTable,
    eventsTable,
  ]);
  resetPiiSubjectKmsForTests();
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  resetPiiSubjectKmsForTests();
  await stack.cleanup();
});

async function createTenant(key: string): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    TenantHandlers.create,
    { key, name: `Tenant ${key}` },
    creator,
  );
  return created.id;
}

async function tierOf(tenantId: string): Promise<TenantTier> {
  return stack.http.queryOk<TenantTier>(TierEngineQueries.getTenantTier, { tenantId }, creator);
}

describe("tier-engine auto-default on tenant creation", () => {
  test("a new tenant gets the default tier with source default", async () => {
    const id = await createTenant("alpha");
    const tier = await tierOf(id);
    expect(tier?.tier).toBe("free");
    expect(tier?.source).toBe(TierAssignmentSources.default);
    expect(tier?.insertedById).toBe(SYSTEM_USER_ID);
  });

  test("each tenant gets its own assignment", async () => {
    const first = await createTenant("alpha");
    const second = await createTenant("beta");
    expect((await tierOf(first))?.tenantId).toBe(first);
    expect((await tierOf(second))?.tenantId).toBe(second);
  });
});
