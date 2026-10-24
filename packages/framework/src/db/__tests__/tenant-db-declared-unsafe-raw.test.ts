import { describe, expect, test } from "bun:test";
import type { EscapeHatchKind } from "@cosmicdrift/kumiko-types/handlers";
import type { TenantDb } from "@cosmicdrift/kumiko-types/tenant-db-types";
import { AccessDeniedError, FrameworkReasons, InternalError } from "../../errors/index.ts";
import { testTenantId } from "../../seeding/seed-users.ts";
import type { DbRunner } from "../connection.ts";
import {
  acknowledgeConventionCrossTenant,
  createTenantDb,
  createUncheckedSystemDb,
  unsafeRawForDeclaredStep,
  withUnsafeRawGrant,
} from "../tenant-db.ts";
import { unscopedRunner } from "./unscoped-runner.ts";

const tenantId = testTenantId(1);
const REASON = "declared step forwarding unsafeRaw";

function fakeRunner(): DbRunner {
  return {
    unsafe: async () => [],
    begin: async () => {
      throw new Error("begin not used in these tests");
    },
  } as unknown as DbRunner;
}

describe("unsafeRawForDeclaredStep", () => {
  test("throws AccessDeniedError without a grant, without reporting", () => {
    const reports: Array<{ kind: EscapeHatchKind; reason: string }> = [];
    const tdb = createTenantDb({
      db: fakeRunner(),
      tenantId,
      mode: "tenant",
      grants: {
        report: (kind, reason) => {
          reports.push({ kind, reason });
        },
      },
    });

    expect(() => unsafeRawForDeclaredStep(tdb, REASON)).toThrow(AccessDeniedError);
    expect(reports).toEqual([]);
  });

  test("returns exactly the bound runner and reports unsafe-raw exactly once, with a grant", () => {
    const runner = fakeRunner();
    const reports: Array<{ kind: EscapeHatchKind; reason: string }> = [];
    const tdb = createTenantDb({
      db: runner,
      tenantId,
      mode: "tenant",
      grants: {
        unsafeRaw: { reason: "handler declared unsafeRaw" },
        report: (kind, reason) => {
          reports.push({ kind, reason });
        },
      },
    });

    expect(unscopedRunner(unsafeRawForDeclaredStep(tdb, REASON))).toBe(runner);
    expect(reports).toEqual([{ kind: "unsafe-raw", reason: REASON }]);
  });

  test("throws for an empty or whitespace-only reason", () => {
    const tdb = createTenantDb({
      db: fakeRunner(),
      tenantId,
      mode: "tenant",
      grants: {
        unsafeRaw: { reason: "handler declared unsafeRaw" },
      },
    });

    expect(() => unsafeRawForDeclaredStep(tdb, "")).toThrow(/non-empty explanation/);
    expect(() => unsafeRawForDeclaredStep(tdb, "   ")).toThrow(/non-empty explanation/);
    expect(() => unsafeRawForDeclaredStep(tdb, "todo")).toThrow(/placeholder/);
  });

  test("throws InternalError for a TenantDb not built by createTenantDb", () => {
    const handBuilt = { tenantId, mode: "tenant" } as unknown as TenantDb;
    expect(() => unsafeRawForDeclaredStep(handBuilt, REASON)).toThrow(InternalError);
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

    expect(() => unsafeRawForDeclaredStep(guardProxy, REASON)).toThrow(InternalError);
    expect(getTrapFired).toBe(false);
  });

  test("resolves to the bound runner for a createUncheckedSystemDb holder, reporting once", () => {
    const runner = fakeRunner();
    const reports: Array<{ kind: EscapeHatchKind; reason: string }> = [];
    const systemDb = createTenantDb({
      db: runner,
      tenantId,
      mode: "system",
      reason: "test builds the system-mode source of a system db view",
    });
    const unchecked = createUncheckedSystemDb(systemDb, undefined, (kind, reason) => {
      reports.push({ kind, reason });
    });

    expect(unscopedRunner(unsafeRawForDeclaredStep(unchecked, REASON))).toBe(runner);
    expect(reports).toEqual([{ kind: "unsafe-raw", reason: REASON }]);
  });

  test("still resolves after withUnsafeRawGrant rebinds the TenantDb", () => {
    const runner = fakeRunner();
    const tdb = createTenantDb({
      db: runner,
      tenantId,
      mode: "tenant",
      grants: {
        unsafeRaw: { reason: "original grant" },
      },
    });
    const regranted = withUnsafeRawGrant(tdb, { reason: "rebind grant" });

    expect(unscopedRunner(unsafeRawForDeclaredStep(regranted, REASON))).toBe(runner);
  });
});

describe("memberReadOnly grant", () => {
  function memberReadOnlyDb(report?: (kind: EscapeHatchKind, reason: string) => void): TenantDb {
    return createTenantDb({
      db: fakeRunner(),
      tenantId,
      mode: "tenant",
      grants: {
        unsafeRaw: { reason: "handler declared unsafeRaw" },
        memberReadOnly: true,
        ...(report && { report }),
      },
    });
  }

  function deniedReason(run: () => unknown): unknown {
    try {
      run();
    } catch (e) {
      if (!(e instanceof AccessDeniedError)) return e;
      const details: unknown = e.details;
      return typeof details === "object" && details !== null && "reason" in details
        ? details.reason
        : details;
    }
    return "no throw";
  }

  test("denies unsafeRaw even with a declared escapeHatch, without reporting", () => {
    const reports: Array<{ kind: EscapeHatchKind; reason: string }> = [];
    const tdb = memberReadOnlyDb((kind, reason) => {
      reports.push({ kind, reason });
    });

    expect(deniedReason(() => tdb.unsafeRaw())).toBe(FrameworkReasons.memberResolutionReadOnly);
    expect(reports).toEqual([]);
  });

  test("denies the declared-step path and survives a withUnsafeRawGrant rebind", () => {
    const tdb = memberReadOnlyDb();
    const regranted = withUnsafeRawGrant(tdb, { reason: "hook re-grant" });

    expect(deniedReason(() => unsafeRawForDeclaredStep(tdb, REASON))).toBe(
      FrameworkReasons.memberResolutionReadOnly,
    );
    expect(deniedReason(() => regranted.unsafeRaw())).toBe(
      FrameworkReasons.memberResolutionReadOnly,
    );
    expect(deniedReason(() => unsafeRawForDeclaredStep(regranted, REASON))).toBe(
      FrameworkReasons.memberResolutionReadOnly,
    );
  });

  test("survives the acknowledgeConventionCrossTenant rebind", () => {
    const crossTenant = acknowledgeConventionCrossTenant(memberReadOnlyDb(), "test: cross-tenant");

    expect(deniedReason(() => crossTenant.unsafeRaw())).toBe(
      FrameworkReasons.memberResolutionReadOnly,
    );
  });
});
