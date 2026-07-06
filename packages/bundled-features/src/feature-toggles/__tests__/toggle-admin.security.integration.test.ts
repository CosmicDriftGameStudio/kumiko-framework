import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { rolesOf } from "@cosmicdrift/kumiko-framework/testing";
import {
  FeatureToggleHandlers,
  FeatureToggleQueries,
  TOGGLE_ADMIN_SCREEN_ID,
} from "../constants";
import { createFeatureTogglesFeature } from "../feature";
import { globalFeatureStateTable } from "../global-feature-state-table";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createFeatureTogglesFeature()],
  });
  await unsafePushTables(stack.db, { globalFeatureStateTable });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("feature-toggles access matrix", () => {
  test("queries, set, and screen are SystemAdmin-only", () => {
    expect(rolesOf(stack.registry.getQueryHandler(FeatureToggleQueries.list)?.access)).toEqual([
      "SystemAdmin",
    ]);
    expect(rolesOf(stack.registry.getQueryHandler(FeatureToggleQueries.registered)?.access)).toEqual([
      "SystemAdmin",
    ]);
    expect(rolesOf(stack.registry.getWriteHandler(FeatureToggleHandlers.set)?.access)).toEqual([
      "SystemAdmin",
    ]);
    const feature = createFeatureTogglesFeature();
    const screen = feature.screens[TOGGLE_ADMIN_SCREEN_ID];
    if (screen && "access" in screen && screen.access && "roles" in screen.access) {
      expect(screen.access.roles).toEqual(["SystemAdmin"]);
    }
  });
});

describe("feature-toggles HTTP access", () => {
  test("SystemAdmin can query list and registered", async () => {
    const admin = createTestUser({ id: 21, roles: ["SystemAdmin"] });
    const list = await stack.http.queryOk<{ items?: readonly unknown[] } | { rows?: readonly unknown[] }>(
      FeatureToggleQueries.list,
      {},
      admin,
    );
    expect(typeof list).toBe("object");
    const registered = await stack.http.queryOk<{ items: readonly unknown[] }>(
      FeatureToggleQueries.registered,
      {},
      admin,
    );
    expect(Array.isArray(registered.items)).toBe(true);
  });

  test("TenantAdmin gets 403 on list, registered, and set", async () => {
    const user = createTestUser({ id: 22, roles: ["TenantAdmin"] });
    expect((await stack.http.query(FeatureToggleQueries.list, {}, user)).status).toBe(403);
    expect((await stack.http.query(FeatureToggleQueries.registered, {}, user)).status).toBe(403);
    expect(
      (await stack.http.write(FeatureToggleHandlers.set, { featureName: "x", enabled: true }, user))
        .status,
    ).toBe(403);
  });
});
