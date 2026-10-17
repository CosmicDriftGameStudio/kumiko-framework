import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestUser, TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigAccessorFactory, createConfigFeature } from "../../config/feature.js";
import { createConfigResolver } from "../../config/resolver.js";
import { configValuesTable } from "../../config/table.js";
import { createTenantFeature, tenantEntity, tenantMembershipsTable } from "../../tenant/index.js";
import { UserHandlers, UserQueries } from "../constants.js";
import { createUserFeature } from "../feature.js";
import { userEntity } from "../schema/user.js";

let stack: TestStack;

beforeAll(async () => {
  const resolver = createConfigResolver();
  stack = await setupTestStack({
    features: [createUserFeature(), createConfigFeature(), createTenantFeature()],
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    }),
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, { tenantMembershipsTable, configValuesTable });
});

afterAll(async () => {
  await stack.cleanup();
});

async function seedUser(email: string): Promise<string> {
  const res = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    { email, displayName: "Tz User", passwordHash: "seeded-hash" },
    TestUsers.systemAdmin,
  );
  return res.id;
}

async function effectiveTimeZoneOf(
  id: string,
  sessionTimezone?: string,
): Promise<string | undefined> {
  const me = await stack.http.queryOk<Record<string, unknown>>(
    UserQueries.me,
    {},
    createTestUser({
      id,
      roles: ["User"],
      ...(sessionTimezone !== undefined && { timezone: sessionTimezone }),
    }),
  );
  return me["effectiveTimeZone"] as string | undefined;
}

describe("user:me effectiveTimeZone", () => {
  test("a user zone wins over the tenant default, without any zone the default Europe/Berlin applies", async () => {
    const id = await seedUser("tz-user@example.com");
    expect(await effectiveTimeZoneOf(id, "America/New_York")).toBe("America/New_York");
    expect(await effectiveTimeZoneOf(id)).toBe("Europe/Berlin");
  });

  test("a user without an own zone gets the tenant's configured zone", async () => {
    await stack.http.writeOk(
      "config:write:set",
      { key: "tenant:config:timezone", value: "Asia/Tokyo" },
      createTestUser({ id: 20, roles: ["Admin"] }),
    );
    const id = await seedUser("tz-tenant@example.com");
    expect(await effectiveTimeZoneOf(id)).toBe("Asia/Tokyo");
    expect(await effectiveTimeZoneOf(id, "America/New_York")).toBe("America/New_York");
  });
});
