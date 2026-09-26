import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { asRawClient, tableExists } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createEntity,
  createSystemConfig,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { resolveObservabilityWiring } from "@cosmicdrift/kumiko-framework/observability";
import {
  createTestDb,
  type TestDb,
  type TestStack,
  TestUsers,
} from "@cosmicdrift/kumiko-framework/stack";
import * as z from "zod";
import { setupAppTestStack } from "../index";
import { noteFeature } from "./note-feature";

const NOTES_TABLE = "public.read_testing_notes";
const METRICS_TOKEN = "setup-app-test-stack-metrics-token-minimum-32-chars!!";

let probe: TestDb;

beforeAll(async () => {
  probe = await createTestDb();
});

afterAll(async () => {
  await probe.cleanup();
});

async function databaseExists(name: string): Promise<boolean> {
  const rows = await asRawClient(probe.db).unsafe<{ found: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${name}') AS found`,
  );
  return rows[0]?.found === true;
}

describe("setupAppTestStack", () => {
  test("mounts the bundled features and creates the registry tables by default", async () => {
    const stack: TestStack = await setupAppTestStack([noteFeature]);
    try {
      expect(stack.registry.getFeature("tenant")).toBeDefined();
      expect(await tableExists(stack.db, NOTES_TABLE)).toBe(true);
      expect(await tableExists(stack.db, "public.read_tenants")).toBe(true);
    } finally {
      await stack.cleanup();
    }
  });

  test("registryTables: false leaves the entity tables uncreated", async () => {
    const stack = await setupAppTestStack([noteFeature], { registryTables: false });
    try {
      expect(await tableExists(stack.db, NOTES_TABLE)).toBe(false);
    } finally {
      await stack.cleanup();
    }
  });

  test("includeBundled: false mounts only the given features", async () => {
    const stack = await setupAppTestStack([noteFeature], { includeBundled: false });
    try {
      expect(stack.registry.getFeature("tenant")).toBeUndefined();
    } finally {
      await stack.cleanup();
    }
  });

  test("metrics option forwarded through setupTestStackFromFeatures to buildServer", async () => {
    const stack: TestStack = await setupAppTestStack([noteFeature], {
      ...resolveObservabilityWiring(METRICS_TOKEN),
    });
    try {
      const noAuth = await stack.app.request("/metrics");
      expect(noAuth.status).toBe(401);

      const scraped = await stack.app.request("/metrics", {
        headers: { Authorization: `Bearer ${METRICS_TOKEN}` },
      });
      expect(scraped.status).toBe(200);
      expect(scraped.headers.get("Content-Type")).toMatch(/openmetrics-text/);
    } finally {
      await stack.cleanup();
    }
  });

  test("drops the ephemeral database when the registry push fails after the stack started", async () => {
    const brokenEntity = createEntity({
      table: "",
      fields: { a: createTextField({ personal: false, reason: "test_fixture" }) },
    });
    const brokenFeature = defineFeature("testing-broken", (r) => {
      r.entity("thing", brokenEntity);
    });
    const dbName = `kumiko_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

    await expect(setupAppTestStack([brokenFeature], { dbName })).rejects.toThrow(
      /zero-length delimited identifier/,
    );
    expect(await databaseExists(dbName)).toBe(false);
  });

  // No optional-chaining fallback on ctx.config — a regression fails loudly instead of silently reading `undefined` (fw#3313).
  test('presets: ["config"] wires ctx.config in a write handler to the value set through config:write:set', async () => {
    const CONFIG_PROBE_KEY = "config-probe:config:greeting";
    const configProbeFeature = defineFeature("config-probe", (r) => {
      r.requires("config");
      r.config({
        keys: {
          greeting: createSystemConfig("text", {
            default: "default-greeting",
            write: access.systemAdmin,
            read: access.systemAdmin,
          }),
        },
      });
      r.writeHandler(
        "read-config",
        z.object({}),
        async (_event, ctx) => {
          if (!ctx.config) throw new Error("ctx.config missing — fw#3313 regressed");
          return { isSuccess: true, data: { value: await ctx.config(CONFIG_PROBE_KEY) } };
        },
        { access: { openToAll: { reason: "fw#3313 regression probe" } } },
      );
    });

    const stack = await setupAppTestStack([configProbeFeature], { presets: ["config"] });
    try {
      await stack.http.writeOk(
        "config:write:set",
        { key: CONFIG_PROBE_KEY, value: "wired-through-preset" },
        TestUsers.systemAdmin,
      );
      const res = await stack.http.writeOk<{ value: string }>(
        "config-probe:write:read-config",
        {},
        TestUsers.systemAdmin,
      );
      expect(res.value).toBe("wired-through-preset");
    } finally {
      await stack.cleanup();
    }
  });
});
