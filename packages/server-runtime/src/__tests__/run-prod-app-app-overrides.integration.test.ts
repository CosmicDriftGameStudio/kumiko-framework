import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type ConfigResolver,
  configValuesTable,
  createConfigFeature,
} from "@cosmicdrift/kumiko-bundled-features/config";
import { access, createTenantConfig, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { buildBootExtraContext } from "../run-prod-app.ts";

const PAGE_SIZE = "appov:config:page-size";

const appovFeature = defineFeature("appov", (r) => {
  r.requires({ features: ["config"] });
  return r.config({
    keys: {
      pageSize: createTenantConfig("number", {
        env: "APPOV_PAGE_SIZE",
        default: 10,
        read: access.admin,
        write: access.admin,
      }),
    },
  });
});

function isConfigResolver(value: unknown): value is ConfigResolver {
  return typeof value === "object" && value !== null && "getWithSource" in value;
}

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [createConfigFeature(), appovFeature] });
  await unsafePushTables(stack.db, { configValuesTable });
});

afterAll(async () => {
  await stack.cleanup();
});

function bootConfigResolver(
  envSource: Record<string, string | undefined>,
  appOverrides?: Record<string, string | number | boolean>,
): ConfigResolver {
  const ctx = buildBootExtraContext({
    db: stack.db,
    features: [createConfigFeature(), appovFeature],
    envSource,
    registry: stack.registry,
    hasAuth: true,
    ...(appOverrides && { appOverrides }),
  });
  const resolver = ctx["configResolver"];
  if (!isConfigResolver(resolver)) throw new Error("boot context has no configResolver");
  return resolver;
}

async function resolvePageSize(resolver: ConfigResolver) {
  const keyDef = stack.registry.getConfigKey(PAGE_SIZE);
  if (!keyDef) throw new Error("page-size key missing");
  return resolver.getWithSource(
    PAGE_SIZE,
    keyDef,
    TestUsers.systemAdmin.tenantId,
    TestUsers.systemAdmin.id,
    stack.db,
  );
}

describe("runProdApp appOverrides", () => {
  test("the env variable of a key is used when no appOverride is set", async () => {
    const traced = await resolvePageSize(bootConfigResolver({ APPOV_PAGE_SIZE: "25" }));
    expect(traced).toEqual({ value: 25, source: "app-override" });
  });

  test("an appOverride wins over the env variable of the same key", async () => {
    const traced = await resolvePageSize(
      bootConfigResolver({ APPOV_PAGE_SIZE: "25" }, { [PAGE_SIZE]: 50 }),
    );
    expect(traced).toEqual({ value: 50, source: "app-override" });
  });

  test("an unknown appOverride key aborts the boot", () => {
    expect(() => bootConfigResolver({}, { "appov:config:does-not-exist": 1 })).toThrow(
      /unknown config key/i,
    );
  });
});
