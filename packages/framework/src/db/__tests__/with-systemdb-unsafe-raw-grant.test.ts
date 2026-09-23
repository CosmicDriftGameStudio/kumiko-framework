// fw#3198 — unit coverage for withSystemDbUnsafeRawGrant: passthrough for
// unknown values, no stacking across repeated rebinds, and the gated runner
// registered under declaredUnsafeRawRunners (unsafeRawForDeclaredStep).

import { describe, expect, test } from "bun:test";
import type { UncheckedSystemDb } from "@cosmicdrift/kumiko-types/tenant-db-types";
import { AccessDeniedError } from "../../errors";
import { testTenantId } from "../../stack";
import type { DbRunner } from "../connection";
import {
  createTenantDb,
  createUncheckedSystemDb,
  unsafeRawForDeclaredStep,
  withSystemDbUnsafeRawGrant,
} from "../tenant-db";

const tenantId = testTenantId(1);

function fakeRunner(): DbRunner {
  return {
    unsafe: async () => [],
    begin: async () => {
      throw new Error("begin not used in these tests");
    },
  } as unknown as DbRunner;
}

describe("withSystemDbUnsafeRawGrant", () => {
  test("passes through a value not built by createUncheckedSystemDb, unchanged", () => {
    const notBuilt = { unsafeRaw: () => fakeRunner() } as unknown as UncheckedSystemDb;
    const rebound = withSystemDbUnsafeRawGrant(notBuilt, { reason: "x" }, "some hook");
    expect(rebound).toBe(notBuilt);
  });

  test("without a grant, unsafeRaw denies with AccessDeniedError naming the caller", () => {
    const runner = fakeRunner();
    const tdb = createTenantDb(runner, tenantId, "system");
    const systemDb = createUncheckedSystemDb(tdb);
    const gated = withSystemDbUnsafeRawGrant(systemDb, undefined, 'postSave hook of feature "x"');
    expect(() => gated.unsafeRaw("a reason")).toThrow(AccessDeniedError);
    expect(() => gated.unsafeRaw("a reason")).toThrow(/postSave hook of feature "x"/);
  });

  test("with a grant, unsafeRaw resolves to the original runner", () => {
    const runner = fakeRunner();
    const tdb = createTenantDb(runner, tenantId, "system");
    const systemDb = createUncheckedSystemDb(tdb);
    const gated = withSystemDbUnsafeRawGrant(systemDb, { reason: "hook reason" }, "hook");
    expect(gated.unsafeRaw("hook reason")).toBe(runner);
  });

  test("repeated rebinding is not stacked — a second rebind reflects only its own grant", () => {
    const runner = fakeRunner();
    const tdb = createTenantDb(runner, tenantId, "system");
    const systemDb = createUncheckedSystemDb(tdb);
    const grantedFirst = withSystemDbUnsafeRawGrant(systemDb, { reason: "first" }, "hook-1");
    const deniedSecond = withSystemDbUnsafeRawGrant(grantedFirst, undefined, "hook-2");
    expect(() => deniedSecond.unsafeRaw("first")).toThrow(AccessDeniedError);
    // Re-granting from the ORIGINAL systemDb (not stacked through grantedFirst) still works.
    const grantedThird = withSystemDbUnsafeRawGrant(systemDb, { reason: "third" }, "hook-3");
    expect(grantedThird.unsafeRaw("third")).toBe(runner);
  });

  test("the gated runner is registered for unsafeRawForDeclaredStep", () => {
    const runner = fakeRunner();
    const tdb = createTenantDb(runner, tenantId, "system");
    const systemDb = createUncheckedSystemDb(tdb);
    const gated = withSystemDbUnsafeRawGrant(systemDb, { reason: "hook reason" }, "hook");
    expect(unsafeRawForDeclaredStep(gated, "hook reason")).toBe(runner);
  });
});
