import { describe, expect, test } from "bun:test";
import type { TenantDb } from "@cosmicdrift/kumiko-types/tenant-db-types";
import { InternalError } from "../../errors/index.ts";
import { testTenantId } from "../../seeding/seed-users.ts";
import type { DbRunner } from "../connection.ts";
import { asRawClient } from "../query.ts";
import { unscopedRunnerOf } from "../row-level-security-scope.ts";
import { createTenantDb, createUncheckedSystemDb, withUnsafeRawGrant } from "../tenant-db.ts";
import { tenantDbRunner } from "../tenant-db-runner.ts";
import { unscopedRunner } from "./unscoped-runner.ts";

// TenantDb.raw is gone from the type; framework-internal callers resolve
// the bound DbRunner through tenant-db-runner.ts's WeakMap instead.

const tenantId = testTenantId(1);

function fakeRunner(): DbRunner {
  return {
    unsafe: async () => [],
    begin: async () => {
      throw new Error("begin not used in these tests");
    },
  } as unknown as DbRunner;
}

describe("TenantDb has no .raw", () => {
  test("compile-time: .raw is not a property of TenantDb", () => {
    const tdb = createTenantDb({ db: fakeRunner(), tenantId });
    // @ts-expect-error TenantDb no longer exposes `raw`.
    expect(tdb.raw).toBeUndefined();
  });

  test("createTenantDb rejects an already tenant-scoped TenantDb: compile error, and raw access throws", () => {
    const tdb = createTenantDb({ db: fakeRunner(), tenantId });
    // @ts-expect-error TenantDb is already tenant-scoped; createTenantDb only accepts a raw DbRunner.
    const rewrapped = createTenantDb({ db: tdb, tenantId });
    expect(() => asRawClient(tenantDbRunner(rewrapped))).toThrow(
      /asRawClient: received a tenant-scoped TenantDb/,
    );
  });
});

describe("tenantDbRunner", () => {
  test("returns the runner bound at createTenantDb(), wrapped in the TenantDb's own scope", () => {
    const runner = fakeRunner();
    const tdb = createTenantDb({ db: runner, tenantId });
    expect(tenantDbRunner(tdb)).not.toBe(runner);
    expect(unscopedRunnerOf(tenantDbRunner(tdb))).toBe(runner);
  });

  test("withUnsafeRawGrant rebinds also resolve to the original runner", () => {
    const runner = fakeRunner();
    const tdb = createTenantDb({ db: runner, tenantId });
    const regranted = withUnsafeRawGrant(tdb, { reason: "test grant" });
    expect(regranted).not.toBe(tdb);
    expect(unscopedRunnerOf(tenantDbRunner(regranted))).toBe(runner);
  });

  test("throws InternalError for a hand-built object not built by createTenantDb", () => {
    const handBuilt = { tenantId, mode: "tenant" } as unknown as TenantDb;
    expect(() => tenantDbRunner(handBuilt)).toThrow(InternalError);
  });

  test("throws InternalError for a throwing guard Proxy, without the proxy's get trap firing", () => {
    let getTrapFired = false;
    const guardProxy = new Proxy(
      {},
      {
        get() {
          getTrapFired = true;
          throw new Error("systemScope guard: property access denied");
        },
      },
    ) as unknown as TenantDb;

    expect(() => tenantDbRunner(guardProxy)).toThrow(InternalError);
    expect(getTrapFired).toBe(false);
  });
});

describe("createUncheckedSystemDb(...).unsafeRaw", () => {
  test("resolves to the runner bound at createTenantDb()", () => {
    const runner = fakeRunner();
    const tdb = createTenantDb({
      db: runner,
      tenantId,
      mode: "system",
      reason: "test proves a system-mode handle exposes no raw runner",
    });
    const systemDb = createUncheckedSystemDb(tdb);
    expect(unscopedRunner(systemDb.unsafeRaw("test reason"))).toBe(runner);
  });
});

describe("createTenantDb without a tenant", () => {
  test("the options form throws instead of binding tenant_id to NULL", () => {
    // @ts-expect-error tenantId is required; untyped callers can still pass undefined.
    expect(() => createTenantDb({ db: fakeRunner(), tenantId: undefined })).toThrow(InternalError);
  });
});
