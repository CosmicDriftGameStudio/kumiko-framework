import { describe, expect, test } from "bun:test";
import type { EscapeHatchKind } from "@cosmicdrift/kumiko-types/handlers";
import type { TenantDb } from "@cosmicdrift/kumiko-types/tenant-db-types";
import { InternalError } from "../../errors/index.ts";
import { testTenantId } from "../../seeding/seed-users.ts";
import type { DbRunner } from "../connection.ts";
import * as dbIndex from "../index.ts";
import {
  acknowledgeConventionCrossTenant,
  createTenantDb,
  withUnsafeRawGrant,
} from "../tenant-db.ts";
import { tenantDbRunner } from "../tenant-db-runner.ts";

const tenantId = testTenantId(1);
const REASON = "operator scan across every tenant";

function fakeRunner(): DbRunner {
  return {
    unsafe: async () => [],
    begin: async () => {
      throw new Error("begin not used in these tests");
    },
  } as unknown as DbRunner;
}

describe("acknowledgeConventionCrossTenant", () => {
  test("returns a system-mode TenantDb with the same tenantId", () => {
    const tdb = createTenantDb({ db: fakeRunner(), tenantId });
    const result = acknowledgeConventionCrossTenant(tdb, REASON);
    expect(result.mode).toBe("system");
    expect(result.tenantId).toBe(tenantId);
  });

  test("reports acknowledge-cross-tenant exactly once via grants.report", () => {
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
    acknowledgeConventionCrossTenant(tdb, REASON);
    expect(reports).toEqual([{ kind: "acknowledge-cross-tenant", reason: REASON }]);
  });

  test("throws for an empty reason", () => {
    const tdb = createTenantDb({ db: fakeRunner(), tenantId });
    expect(() => acknowledgeConventionCrossTenant(tdb, "")).toThrow();
    expect(() => acknowledgeConventionCrossTenant(tdb, "   ")).toThrow();
  });

  test("throws for a placeholder reason", () => {
    const tdb = createTenantDb({ db: fakeRunner(), tenantId });
    expect(() => acknowledgeConventionCrossTenant(tdb, "todo")).toThrow(/placeholder/);
  });

  test("throws InternalError for a TenantDb not built by createTenantDb", () => {
    const handBuilt = { tenantId, mode: "tenant" } as unknown as TenantDb;
    expect(() => acknowledgeConventionCrossTenant(handBuilt, REASON)).toThrow(InternalError);
  });

  test("still resolves after withUnsafeRawGrant rebinds the TenantDb", () => {
    const runner = fakeRunner();
    const tdb = createTenantDb({ db: runner, tenantId });
    const regranted = withUnsafeRawGrant(tdb, { reason: "unrelated unsafeRaw grant" });
    const result = acknowledgeConventionCrossTenant(regranted, REASON);
    expect(result.mode).toBe("system");
    expect(tenantDbRunner(result)).toBe(runner);
  });

  test("tenantDbRunner(result) resolves to the original runner", () => {
    const runner = fakeRunner();
    const tdb = createTenantDb({ db: runner, tenantId });
    const result = acknowledgeConventionCrossTenant(tdb, REASON);
    expect(tenantDbRunner(result)).toBe(runner);
  });

  test("db/index.ts does not export acknowledgeConventionCrossTenant", () => {
    expect("acknowledgeConventionCrossTenant" in dbIndex).toBe(false);
  });
});
