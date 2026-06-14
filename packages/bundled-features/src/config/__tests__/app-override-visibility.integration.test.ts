import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  type ConfigCascade,
  createTenantConfig,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { ConfigHandlers, ConfigQueries } from "../constants";
import { createConfigAccessorFactory, createConfigFeature } from "../feature";
import { buildEnvConfigOverrides, createConfigResolver } from "../resolver";
import { configValuesTable } from "../table";

// Proves the ENV→app-override bridge end-to-end over real HTTP:
//   - a transparently-inherited key (default inheritedToTenant) surfaces the
//     ENV-bridged app-override to a tenant (the D3 fix — values.query used to
//     fall to keyDef.default and never showed the inherited app-override);
//   - an inheritedToTenant:false key must NOT leak the platform ENV value to a
//     tenant-side viewer through the app-override rung (the regression guard
//     for the #376 redaction, which previously only stripped system-row);
//   - a tenant's own row still beats the app-override.

let stack: TestStack;
let db: DbConnection;

const systemAdmin = TestUsers.systemAdmin; // roles ["SystemAdmin"]
const tenantAdmin = createTestUser({ id: 2 }); // roles ["Admin"]

const PAGE_SIZE = "appcfg:config:page-size";
const API_BASE = "appcfg:config:api-base";

const FAKE_ENV = {
  APPCFG_PAGE_SIZE: "25",
  APPCFG_API_BASE: "https://internal.example.com",
};

const appcfgFeature = defineFeature("appcfg", (r) => {
  r.requires("config");
  return r.config({
    keys: {
      // Transparent inheritance + ENV-bridged: a tenant sees the platform's
      // ENV default until it sets its own value.
      pageSize: createTenantConfig("number", {
        env: "APPCFG_PAGE_SIZE",
        default: 10,
        read: access.admin,
        write: access.admin,
      }),
      // inheritedToTenant:false + ENV-bridged: the platform value must stay
      // hidden from tenant-side viewers — including via app-override.
      apiBase: createTenantConfig("text", {
        env: "APPCFG_API_BASE",
        inheritedToTenant: false,
        read: access.admin,
        write: access.systemAdmin,
      }),
    },
  });
});

type Values = Record<string, { value: unknown; source: string }>;
type Cascades = Record<string, ConfigCascade>;
const overrideLevel = (c: Cascades, key: string) =>
  c[key]?.levels.find((l) => l.source === "app-override");

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createConfigFeature(), appcfgFeature],
    extraContext: ({ registry }) => {
      const resolver = createConfigResolver({
        appOverrides: buildEnvConfigOverrides(registry, FAKE_ENV),
      });
      return {
        configResolver: resolver,
        _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      };
    },
  });
  db = stack.db;
  await unsafePushTables(db, { configValuesTable });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("ENV→app-override bridge — config:query:values", () => {
  test("D3: a transparently-inherited key surfaces the ENV app-override, not keyDef.default", async () => {
    const res = await stack.http.queryOk<Values>(ConfigQueries.values, {}, tenantAdmin);
    expect(res[PAGE_SIZE]?.value).toBe(25); // number, coerced from env — not 10 (default)
    expect(res[PAGE_SIZE]?.source).toBe("app-override");
  });

  test("leak guard: inheritedToTenant:false hides the ENV app-override from a tenant", async () => {
    const res = await stack.http.queryOk<Values>(ConfigQueries.values, {}, tenantAdmin);
    expect(res[API_BASE]?.value).not.toBe("https://internal.example.com");
    expect(res[API_BASE]?.source).not.toBe("app-override");
  });
});

describe("ENV→app-override bridge — config:query:cascade", () => {
  test("leak guard: the app-override level is redacted for a tenant on an inheritedToTenant:false key", async () => {
    const res = await stack.http.queryOk<Cascades>(
      ConfigQueries.cascade,
      { keys: [API_BASE] },
      tenantAdmin,
    );
    const ov = overrideLevel(res, API_BASE);
    expect(ov?.value).toBeUndefined();
    expect(ov?.hasValue).toBe(false);
    expect(res[API_BASE]?.value).not.toBe("https://internal.example.com");
  });

  test("SystemAdmin still sees the inherited ENV app-override", async () => {
    const res = await stack.http.queryOk<Cascades>(
      ConfigQueries.cascade,
      { keys: [API_BASE] },
      systemAdmin,
    );
    expect(overrideLevel(res, API_BASE)?.value).toBe("https://internal.example.com");
    expect(res[API_BASE]?.value).toBe("https://internal.example.com");
  });
});

describe("ENV→app-override bridge — precedence", () => {
  test("a tenant's own row beats the ENV app-override", async () => {
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: PAGE_SIZE, value: 50, scope: "tenant" },
      tenantAdmin,
    );
    const res = await stack.http.queryOk<Values>(ConfigQueries.values, {}, tenantAdmin);
    expect(res[PAGE_SIZE]?.value).toBe(50);
    expect(res[PAGE_SIZE]?.source).toBe("tenant-row");
  });
});
