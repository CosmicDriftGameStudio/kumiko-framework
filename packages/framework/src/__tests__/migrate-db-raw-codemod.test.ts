import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { migrateDbRawSource } from "../scripts/codemod/migrate-db-raw";

const FIXTURES_DIR = join(import.meta.dir, "fixtures", "migrate-db-raw");
const DEFAULT_GLOBAL_TABLES = new Set(["userTable", "globalFeatureStateTable"]);

function readFixture(name: string): { input: string; expected: string } {
  return {
    input: readFileSync(join(FIXTURES_DIR, `${name}.input.ts`), "utf8"),
    expected: readFileSync(join(FIXTURES_DIR, `${name}.expected.ts`), "utf8"),
  };
}

describe("migrateDbRawSource", () => {
  it("rewrites a global fetchOne with type args to db.global().fetchOne()", () => {
    const { input, expected } = readFixture("global-fetch");
    const result = migrateDbRawSource(input, "global-fetch.ts", {
      globalTables: DEFAULT_GLOBAL_TABLES,
    });

    expect(result.output).toBe(expected);
    expect(result.rewrites).toHaveLength(1);
    expect(result.rewrites[0]?.rule).toBe("global-table");
    expect(result.rewrites[0]?.line).toBe(7);
    expect(result.manual).toHaveLength(0);
  });

  it("rewrites a global selectMany with options to db.global().selectMany()", () => {
    const { input, expected } = readFixture("global-select");
    const result = migrateDbRawSource(input, "global-select.ts", {
      globalTables: DEFAULT_GLOBAL_TABLES,
    });

    expect(result.output).toBe(expected);
    expect(result.rewrites).toHaveLength(1);
    expect(result.rewrites[0]?.rule).toBe("global-table");
    expect(result.manual).toHaveLength(0);
  });

  it("rewrites own-tenant filtering via event.user.tenantId", () => {
    const { input, expected } = readFixture("own-tenant-event");
    const result = migrateDbRawSource(input, "own-tenant-event.ts", {
      globalTables: DEFAULT_GLOBAL_TABLES,
    });

    expect(result.output).toBe(expected);
    expect(result.rewrites).toHaveLength(1);
    expect(result.rewrites[0]?.rule).toBe("own-tenant");
    expect(result.manual).toHaveLength(0);
  });

  it("rewrites own-tenant filtering via a const tenantId shorthand binding", () => {
    const { input, expected } = readFixture("own-tenant-const-shorthand");
    const result = migrateDbRawSource(input, "own-tenant-const-shorthand.ts", {
      globalTables: DEFAULT_GLOBAL_TABLES,
    });

    expect(result.output).toBe(expected);
    expect(result.rewrites).toHaveLength(1);
    expect(result.rewrites[0]?.rule).toBe("own-tenant");
    expect(result.manual).toHaveLength(0);
  });

  it("leaves unsafe call sites untouched and reports them as manual", () => {
    const { input, expected } = readFixture("manual-only");
    const result = migrateDbRawSource(input, "manual-only.ts", {
      globalTables: DEFAULT_GLOBAL_TABLES,
    });

    expect(result.output).toBe(expected);
    expect(result.rewrites).toHaveLength(0);
    expect(result.manual).toHaveLength(4);

    const byText = new Map(result.manual.map((m) => [m.text, m]));

    const insertOneSite = byText.get(
      "insertOne(ctx.db.raw, auditTable, { tenantId, action: event.payload.action })",
    );
    expect(insertOneSite).toBeDefined();
    expect(insertOneSite?.line).toBe(9);
    expect(insertOneSite?.enclosing).toBe("handler");

    const countWhereSite = byText.get('countWhere(ctx.db.raw, invoiceTable, { status: "open" })');
    expect(countWhereSite).toBeDefined();
    expect(countWhereSite?.line).toBe(10);

    const createTenantDbSite = byText.get('createTenantDb(ctx.db.raw, x, "system")');
    expect(createTenantDbSite).toBeDefined();
    expect(createTenantDbSite?.line).toBe(16);
    expect(createTenantDbSite?.enclosing).toBe("bootstrapSystemDb");

    const systemDbSite = byText.get("ctx.systemDb.acknowledgeCrossTenant(r).raw");
    expect(systemDbSite).toBeDefined();
    expect(systemDbSite?.line).toBe(23);
  });

  it("does not rewrite when tenantId comes from a non-user-scope source (payload/token)", () => {
    const { input } = readFixture("manual-only");
    const result = migrateDbRawSource(input, "manual-only.ts", {
      globalTables: DEFAULT_GLOBAL_TABLES,
    });

    expect(result.output).toContain("await insertOne(ctx.db.raw, auditTable");
  });

  it("prunes an unused free-function import after rewriting its only call site", () => {
    const { input, expected } = readFixture("global-fetch");
    const result = migrateDbRawSource(input, "global-fetch.ts", {
      globalTables: DEFAULT_GLOBAL_TABLES,
    });

    expect(result.output).not.toContain(
      'import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";',
    );
    expect(result.output).toBe(expected);
  });

  it("keeps a still-referenced sibling import while pruning the rewritten one", () => {
    const { input, expected } = readFixture("import-pruning");
    const result = migrateDbRawSource(input, "import-pruning.ts", {
      globalTables: DEFAULT_GLOBAL_TABLES,
    });

    expect(result.output).toBe(expected);
    expect(result.output).toContain(
      'import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";',
    );
    expect(result.output.split("\n")[0]).not.toContain("fetchOne");
  });
});
