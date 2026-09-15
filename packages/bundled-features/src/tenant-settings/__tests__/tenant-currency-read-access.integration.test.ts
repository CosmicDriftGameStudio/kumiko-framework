// fw#2933: a `money` field's `currency: { kind: "tenant" }` declaration
// resolves in the renderer via config:query:values — this pins that a
// normal (non-admin) tenant user, not just an Admin, can read
// tenant-settings:config:currency through that query. Real HTTP via
// setupTestStack (never createTestDispatcher).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  configValuesTable,
  createConfigAccessorFactory,
  createConfigFeature,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { TenantSettingsConfig } from "../constants";
import { createTenantSettingsFeature } from "../feature";

let stack: TestStack;

beforeAll(async () => {
  const resolver = createConfigResolver();
  stack = await setupTestStack({
    features: [createConfigFeature(), createTenantSettingsFeature({ defaultCurrency: "GBP" })],
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    }),
  });
  await unsafePushTables(stack.db, { configValuesTable });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("tenant-settings currency — read access", () => {
  test('a non-admin tenant user (roles: ["User"]) can read tenant-settings:config:currency via config:query:values', async () => {
    const res = await stack.http.queryOk<Record<string, { value: unknown }>>(
      "config:query:values",
      {},
      TestUsers.user,
    );
    expect(res[TenantSettingsConfig.currency]?.value).toBe("GBP");
  });
});
