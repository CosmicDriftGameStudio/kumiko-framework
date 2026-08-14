import { describe, expect, test } from "bun:test";
import { SYSTEM_TENANT_ID } from "../../engine";
import { testTenantId } from "../../stack";
import type { DbRunner } from "../connection";
import { createTenantDb, createUncheckedSystemDb, SYSTEM_SCOPE_CHECK_BRAND } from "../tenant-db";

// createUncheckedSystemDb wraps a "system"-mode TenantDb (r.systemScope())
// so a handler must explicitly clear a self-check before using it — none of
// these checks execute a query, so a runner that always throws is enough to
// prove the wrapper never falls through to the DB on a mismatch.
function unusedRunner(): DbRunner {
  return {
    unsafe: async () => {
      throw new Error("unchecked-system-db tests must not reach the DB");
    },
    begin: async () => {
      throw new Error("unchecked-system-db tests must not reach the DB");
    },
  } as DbRunner;
}

const own = testTenantId(1);
const foreign = testTenantId(2);

describe("createUncheckedSystemDb", () => {
  test("carries the SYSTEM_SCOPE_CHECK_BRAND", () => {
    const systemDb = createTenantDb(unusedRunner(), own, "system");
    const unchecked = createUncheckedSystemDb(systemDb);

    expect(unchecked[SYSTEM_SCOPE_CHECK_BRAND]).toBe(true);
  });

  describe("assertTenantMatch", () => {
    test("returns the underlying TenantDb when the tenantId matches", () => {
      const systemDb = createTenantDb(unusedRunner(), own, "system");
      const unchecked = createUncheckedSystemDb(systemDb);

      expect(unchecked.assertTenantMatch(own)).toBe(systemDb);
    });

    test("throws AccessDeniedError when the tenantId doesn't match", () => {
      const systemDb = createTenantDb(unusedRunner(), own, "system");
      const unchecked = createUncheckedSystemDb(systemDb);

      expect(() => unchecked.assertTenantMatch(foreign)).toThrow(/tenant self-check failed/);
    });
  });

  describe("assertRowsTenant", () => {
    test("returns the rows unchanged when every row matches", () => {
      const systemDb = createTenantDb(unusedRunner(), own, "system");
      const unchecked = createUncheckedSystemDb(systemDb);
      const rows = [
        { tenantId: own, name: "a" },
        { tenantId: own, name: "b" },
      ];

      expect(unchecked.assertRowsTenant(rows, "tenantId")).toBe(rows);
    });

    test("throws AccessDeniedError on the first mismatched row instead of filtering", () => {
      const systemDb = createTenantDb(unusedRunner(), own, "system");
      const unchecked = createUncheckedSystemDb(systemDb);
      const rows = [
        { tenantId: own, name: "a" },
        { tenantId: foreign, name: "b" },
      ];

      expect(() => unchecked.assertRowsTenant(rows, "tenantId")).toThrow(
        /row tenant self-check failed/,
      );
    });

    test("an empty row array trivially passes", () => {
      const systemDb = createTenantDb(unusedRunner(), own, "system");
      const unchecked = createUncheckedSystemDb(systemDb);

      expect(unchecked.assertRowsTenant([], "tenantId")).toEqual([]);
    });

    test("accepts SYSTEM_TENANT_ID rows as reference data, mirroring tenant-mode readWhere", () => {
      const systemDb = createTenantDb(unusedRunner(), own, "system");
      const unchecked = createUncheckedSystemDb(systemDb);
      const rows = [
        { tenantId: own, name: "a" },
        { tenantId: SYSTEM_TENANT_ID, name: "global-default" },
      ];

      expect(unchecked.assertRowsTenant(rows, "tenantId")).toBe(rows);
    });
  });

  describe("acknowledgeCrossTenant", () => {
    test("returns the underlying TenantDb without comparing tenants when given a reason", () => {
      const systemDb = createTenantDb(unusedRunner(), own, "system");
      const unchecked = createUncheckedSystemDb(systemDb);

      expect(unchecked.acknowledgeCrossTenant("user feature is cross-tenant by design")).toBe(
        systemDb,
      );
    });

    test("throws on an empty reason", () => {
      const systemDb = createTenantDb(unusedRunner(), own, "system");
      const unchecked = createUncheckedSystemDb(systemDb);

      expect(() => unchecked.acknowledgeCrossTenant("")).toThrow(/non-empty reason/);
    });

    test("throws on a whitespace-only reason", () => {
      const systemDb = createTenantDb(unusedRunner(), own, "system");
      const unchecked = createUncheckedSystemDb(systemDb);

      expect(() => unchecked.acknowledgeCrossTenant("   ")).toThrow(/non-empty reason/);
    });
  });

  describe("outsideTransaction", () => {
    describe("assertTenantMatch", () => {
      test("returns the outside-transaction TenantDb, not the in-tx one, when the tenantId matches", () => {
        const systemDb = createTenantDb(unusedRunner(), own, "system");
        const outsideTxDb = createTenantDb(unusedRunner(), own, "system");
        const unchecked = createUncheckedSystemDb(systemDb, outsideTxDb);

        const result = unchecked.outsideTransaction.assertTenantMatch(own);
        expect(result).toBe(outsideTxDb);
        expect(result).not.toBe(systemDb);
      });

      test("throws AccessDeniedError when the tenantId doesn't match", () => {
        const systemDb = createTenantDb(unusedRunner(), own, "system");
        const outsideTxDb = createTenantDb(unusedRunner(), own, "system");
        const unchecked = createUncheckedSystemDb(systemDb, outsideTxDb);

        expect(() => unchecked.outsideTransaction.assertTenantMatch(foreign)).toThrow(
          /outsideTransaction tenant self-check failed/,
        );
      });

      test("throws when no outside-transaction db was configured, even for a matching tenantId", () => {
        const systemDb = createTenantDb(unusedRunner(), own, "system");
        const unchecked = createUncheckedSystemDb(systemDb);

        expect(() => unchecked.outsideTransaction.assertTenantMatch(own)).toThrow(
          /no outside-transaction database source is configured/,
        );
      });
    });

    describe("acknowledgeCrossTenant", () => {
      test("returns the outside-transaction TenantDb without comparing tenants when given a reason", () => {
        const systemDb = createTenantDb(unusedRunner(), own, "system");
        const outsideTxDb = createTenantDb(unusedRunner(), own, "system");
        const unchecked = createUncheckedSystemDb(systemDb, outsideTxDb);

        const result = unchecked.outsideTransaction.acknowledgeCrossTenant(
          "durability write is cross-tenant by design",
        );
        expect(result).toBe(outsideTxDb);
        expect(result).not.toBe(systemDb);
      });

      test("throws on an empty reason", () => {
        const systemDb = createTenantDb(unusedRunner(), own, "system");
        const outsideTxDb = createTenantDb(unusedRunner(), own, "system");
        const unchecked = createUncheckedSystemDb(systemDb, outsideTxDb);

        expect(() => unchecked.outsideTransaction.acknowledgeCrossTenant("")).toThrow(
          /non-empty reason/,
        );
      });

      test("throws when no outside-transaction db was configured, even with a valid reason", () => {
        const systemDb = createTenantDb(unusedRunner(), own, "system");
        const unchecked = createUncheckedSystemDb(systemDb);

        expect(() => unchecked.outsideTransaction.acknowledgeCrossTenant("valid reason")).toThrow(
          /no outside-transaction database source is configured/,
        );
      });
    });
  });
});
