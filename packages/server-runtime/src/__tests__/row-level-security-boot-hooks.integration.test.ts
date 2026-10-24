// Boot and tenant-resolution hooks that receive a `db` run before any tenant exists. With
// rowLevelSecurity "on" they must see the same system scope in runProdApp, runWorkerApp and the
// test stack; extraContext keeps the ambient request scope and is not covered here.
// Real Postgres + Redis; the application role enforces the policies.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { EntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import { collectTableMetas, type DbConnection, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { composeEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import { seedRow } from "@cosmicdrift/kumiko-testing/helpers";
import {
  applicationRoleUrlOf,
  setupTestStack,
  type TestStack,
} from "@cosmicdrift/kumiko-testing/stack";
import { runProdApp } from "../run-prod-app.ts";
import { runWorkerApp } from "../run-worker-app.ts";
import { makeProbeFeature } from "./boot-probe-fixture.ts";

const TABLE = "rls_boot_hooks_probe";
const probeFeature = makeProbeFeature({ name: "rls-boot-hooks-probe", table: TABLE });
const probeTable: EntityTableMeta = (() => {
  const meta = collectTableMetas([probeFeature]).find((m) => m.tableName === TABLE);
  if (!meta) throw new Error(`probe table ${TABLE} missing`);
  return meta;
})();

const ADMIN_URL = process.env["TEST_DATABASE_URL"] ?? "";
const SUFFIX = Date.now().toString(36);
const APP_DB = `kumiko_rlshooks_app_${SUFFIX}`;
const PARITY_DB = `kumiko_rlshooks_par_${SUFFIX}`;
const SEEDED_TENANT = crypto.randomUUID();
const ROW_NAME = "visible-to-boot-hooks";

let appStack: TestStack;
let parityStack: TestStack | undefined;
const stoppers: Array<() => Promise<void>> = [];

function envFor(dbName: string) {
  return {
    DATABASE_URL: applicationRoleUrlOf(ADMIN_URL, dbName),
    REDIS_URL: process.env["REDIS_URL"] ?? "redis://localhost:16379",
    JWT_SECRET: "test-rls-boot-hooks-secret-32-chars!",
    PORT: "0",
  };
}

// A rejected read must fail the assertion, not surface as an unhandled rejection.
async function readNames(db: DbConnection): Promise<readonly unknown[] | Error> {
  try {
    const rows = await selectMany<{ name: string }>(db, probeTable, {});
    return rows.map((row) => row.name);
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

async function seedProbeRow(stack: TestStack): Promise<void> {
  await seedRow(stack.db, probeTable, {
    id: crypto.randomUUID(),
    tenantId: SEEDED_TENANT,
    name: ROW_NAME,
  });
}

beforeAll(async () => {
  if (!ADMIN_URL) throw new Error("TEST_DATABASE_URL must be set");
  appStack = await setupTestStack({ features: [probeFeature], dbName: APP_DB });
  await seedProbeRow(appStack);
});

afterEach(async () => {
  for (const stop of stoppers.splice(0)) await stop();
});

afterAll(async () => {
  await appStack.cleanup();
  await parityStack?.cleanup();
});

describe("rowLevelSecurity on: boot hooks see a system-scoped db", () => {
  test("runProdApp anonymousAccess factory and wire hook read the tenant table", async () => {
    let factoryRead: Promise<readonly unknown[] | Error> | undefined;
    let wireRead: readonly unknown[] | Error | undefined;
    const handle = await runProdApp({
      features: [probeFeature],
      rowLevelSecurity: "on",
      kmsMode: { plaintextReason: "test: row level security hook scope focus, not crypto" },
      envSource: envFor(APP_DB),
      envSchema: composeEnvSchema({ features: [] }),
      anonymousAccess: (deps) => {
        factoryRead = readNames(deps.db);
        return {};
      },
      wire: async (deps) => {
        wireRead = await readNames(deps.db);
      },
      autoListen: false,
      migrations: false,
    });
    stoppers.push(() => handle.stop());
    expect(await factoryRead).toEqual([ROW_NAME]);
    expect(wireRead).toEqual([ROW_NAME]);
  });

  test("runWorkerApp wireComponents reads the tenant table", async () => {
    let wireRead: readonly unknown[] | Error | undefined;
    const handle = await runWorkerApp({
      features: [probeFeature],
      rowLevelSecurity: "on",
      migrations: false,
      jobs: { queueNamePrefix: `test-rlshooks-${SUFFIX}` },
      envSource: envFor(APP_DB),
      wireComponents: async (deps) => {
        wireRead = await readNames(deps.db);
      },
    });
    stoppers.push(() => handle.stop());
    expect(wireRead).toEqual([ROW_NAME]);
  });

  // setupTestStack at "on" connects as the application role, so the pool enforces the policies
  // exactly as in prod and the parity check is meaningful.
  test("setupTestStack anonymousAccess factory and enrichAnonymousAccess get the same scope", async () => {
    let factoryDb: DbConnection | undefined;
    let enrichDb: DbConnection | undefined;
    parityStack = await setupTestStack({
      features: [probeFeature],
      dbName: PARITY_DB,
      anonymousAccess: (deps) => {
        factoryDb = deps.db;
        return {};
      },
      enrichAnonymousAccess: async (base, deps) => {
        enrichDb = deps.db;
        return base;
      },
    });
    await seedProbeRow(parityStack);
    if (!factoryDb || !enrichDb)
      throw new Error("test stack never called the anonymousAccess hooks");
    expect(await readNames(factoryDb)).toEqual([ROW_NAME]);
    expect(await readNames(enrichDb)).toEqual([ROW_NAME]);
  });

  // Custom seeds run inside the boot system scope, so the raw boot db sees every tenant.
  test("runProdApp custom seed reads rows of several tenants with the given db", async () => {
    const otherName = "second-tenant-row";
    await seedRow(appStack.db, probeTable, {
      id: crypto.randomUUID(),
      tenantId: crypto.randomUUID(),
      name: otherName,
    });
    let seedRead: readonly unknown[] | Error | undefined;
    const handle = await runProdApp({
      features: [probeFeature],
      rowLevelSecurity: "on",
      kmsMode: { plaintextReason: "test: row level security hook scope focus, not crypto" },
      envSource: envFor(APP_DB),
      envSchema: composeEnvSchema({ features: [] }),
      seeds: [
        async ({ db }) => {
          seedRead = await readNames(db);
        },
      ],
      autoListen: false,
      migrations: false,
    });
    stoppers.push(() => handle.stop());
    expect(Array.isArray(seedRead) ? [...seedRead].sort() : seedRead).toEqual(
      [ROW_NAME, otherName].sort(),
    );
  });
});
