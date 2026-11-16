// (key, tenantId, userId) is unique in the table, but a NULL userId makes every row distinct to
// Postgres, so two parallel first writes of a tenant-level key must be serialised by the handler.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { access, createTenantConfig, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { createConfigFeature } from "../feature.ts";
import { configValuesTable } from "../table.ts";
import { ConfigHandlers } from "../web/constants.ts";

const KEY = "racedemo:config:label";

const raceDemoFeature = defineFeature("racedemo", (r) => {
  r.requires({ features: ["config"] });
  r.config({
    keys: {
      label: createTenantConfig("text", {
        default: "none",
        write: access.roles("SystemAdmin", "Admin"),
        read: access.admin,
      }),
    },
  });
});

const admin = createTestUser({ id: 21, roles: ["Admin"] });
let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [createConfigFeature(), raceDemoFeature] });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("config:write:set concurrency", () => {
  test("parallel first writes of the same tenant-level key leave exactly one row", async () => {
    await Promise.all(
      ["a", "b", "c", "d"].map((value) =>
        stack.http.write(ConfigHandlers.set, { key: KEY, value }, admin),
      ),
    );

    const rows = await selectMany(stack.db, configValuesTable, { key: KEY });
    expect(rows).toHaveLength(1);
  });
});
