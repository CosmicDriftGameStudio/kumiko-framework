import { describe, expect, test } from "bun:test";
import type { TenantDb } from "@cosmicdrift/kumiko-types/tenant-db-types";
import { InternalError } from "../../errors";
import { testTenantId } from "../../stack";
import type { DbRunner } from "../connection";
import { createTenantDb, createUncheckedSystemDb, withUnsafeRawGrant } from "../tenant-db";
import { tenantDbRunner } from "../tenant-db-runner";

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
    const tdb = createTenantDb(fakeRunner(), tenantId);
    // @ts-expect-error TenantDb no longer exposes `raw`.
    expect(tdb.raw).toBeUndefined();
  });
});

describe("tenantDbRunner", () => {
  test("returns the runner bound at createTenantDb() (identity)", () => {
    const runner = fakeRunner();
    const tdb = createTenantDb(runner, tenantId);
    expect(tenantDbRunner(tdb)).toBe(runner);
  });

  test("withUnsafeRawGrant rebinds also resolve to the original runner", () => {
    const runner = fakeRunner();
    const tdb = createTenantDb(runner, tenantId);
    const regranted = withUnsafeRawGrant(tdb, { reason: "test grant" });
    expect(regranted).not.toBe(tdb);
    expect(tenantDbRunner(regranted)).toBe(runner);
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
    const tdb = createTenantDb(runner, tenantId, "system");
    const systemDb = createUncheckedSystemDb(tdb);
    expect(systemDb.unsafeRaw("test reason")).toBe(runner);
  });
});
