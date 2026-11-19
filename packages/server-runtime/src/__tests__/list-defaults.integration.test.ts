import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  configValuesTable,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import { tenantEntity, tenantMembershipsTable } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { userEntity } from "@cosmicdrift/kumiko-bundled-features/user";
import {
  createEntity,
  createTextField,
  defineFeature,
  type ListDefaultsOptions,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { composeFeatures } from "../compose-features.ts";

const LIST_DEFAULTS: ListDefaultsOptions = {
  table: { columnPicker: true, pinning: true, export: { xlsx: true } },
  pinFirstColumn: true,
};

const shopFeature = defineFeature("shop", (r) => {
  r.entity(
    createEntity({
      name: "item",
      fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
    }),
  );
  r.screen({
    id: "item-list",
    type: "entityList",
    entity: "item",
    columns: ["name"],
    dormant: true,
  });
});

type SchemaScreen = { id: string; table?: unknown; columns?: unknown };
type SchemaBody = { features: Array<{ featureName: string; screens: SchemaScreen[] }> };

function isSchemaScreen(value: unknown): value is SchemaScreen {
  return isPlainObject(value) && typeof value["id"] === "string";
}

function isSchemaBody(value: unknown): value is SchemaBody {
  return (
    isPlainObject(value) &&
    Array.isArray(value["features"]) &&
    value["features"].every(
      (feature) =>
        isPlainObject(feature) &&
        typeof feature["featureName"] === "string" &&
        Array.isArray(feature["screens"]) &&
        feature["screens"].every(isSchemaScreen),
    )
  );
}

function screenFromSchema(body: SchemaBody, featureName: string, shortId: string): SchemaScreen {
  const screen = body.features
    .find((feature) => feature.featureName === featureName)
    ?.screens.find((candidate) => candidate.id.endsWith(shortId));
  if (screen === undefined) throw new Error(`schema has no screen ${featureName}/${shortId}`);
  return screen;
}

let stack: TestStack;

beforeAll(async () => {
  const features = composeFeatures([shopFeature], {
    includeBundled: true,
    listDefaults: LIST_DEFAULTS,
  });
  stack = await setupTestStack({
    features,
    extraContext: () => ({ configResolver: createConfigResolver() }),
    anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("composeFeatures listDefaults in GET /api/schema", () => {
  test("every list carries the shared table block", async () => {
    const token = await stack.jwt.sign(TestUsers.systemAdmin);
    const res = await stack.app.request("/api/schema", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    if (!isSchemaBody(body)) throw new Error("unexpected /api/schema body");

    const userList = screenFromSchema(body, "user", "user-list");
    expect(userList.table).toEqual(LIST_DEFAULTS.table);
    expect(Array.isArray(userList.columns) && userList.columns[0]).toEqual({
      field: "email",
      pinned: "left",
    });
    const shopList = screenFromSchema(body, "shop", "item-list");
    expect(shopList.table).toEqual(LIST_DEFAULTS.table);
    expect(Array.isArray(shopList.columns) && shopList.columns[0]).toEqual({
      field: "name",
      pinned: "left",
    });
  });
});
