import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { asRawClient, tableExists } from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createTestDb, type TestDb, type TestStack } from "@cosmicdrift/kumiko-framework/stack";
import { setupAppTestStack } from "../index";
import { noteFeature } from "./note-feature";

const NOTES_TABLE = "public.read_testing_notes";

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
});
