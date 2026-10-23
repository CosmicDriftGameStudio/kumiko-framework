import { describe, expect, test } from "bun:test";
import type { EntityTableMeta } from "../entity-table-meta.ts";
import { renderTableDdl, renderTablesDdl } from "../render-ddl.ts";
import {
  isTableRowLevelSecurityRecord,
  renderCreatePolicy,
  renderDisableRowLevelSecurity,
  renderEnableRowLevelSecurity,
  renderRowLevelSecurityFlags,
  renderTableRowLevelSecurityDdl,
  rowLevelSecurityByTable,
  tenantRowLevelSecurityFor,
} from "../render-rls-ddl.ts";

function tenantMeta(tableName: string, tenantType: "uuid" | "text" = "uuid"): EntityTableMeta {
  return {
    tableName,
    source: "unmanaged",
    indexes: [],
    columns: [
      { name: "id", pgType: "uuid", notNull: true, primaryKey: true },
      { name: "tenant_id", pgType: tenantType, notNull: true },
    ],
  };
}

const globalMeta: EntityTableMeta = {
  tableName: "store_global",
  source: "unmanaged",
  indexes: [],
  columns: [{ name: "id", pgType: "uuid", notNull: true, primaryKey: true }],
};

const SYSTEM = "00000000-0000-4000-8000-000000000000";

function isolation(sqlType: string): string {
  return `"tenant_id" = NULLIF(current_setting('kumiko.tenant_id', true), '')::${sqlType} OR current_setting('kumiko.scope', true) = 'system'`;
}

describe("renderTableRowLevelSecurityDdl", () => {
  test("renders policies before ENABLE and FORCE for a uuid tenant_id", () => {
    expect(renderTableRowLevelSecurityDdl(tenantMeta("store_items"))).toEqual([
      `DROP POLICY IF EXISTS "kumiko_tenant_isolation" ON "store_items";`,
      `CREATE POLICY "kumiko_tenant_isolation" ON "store_items" AS PERMISSIVE FOR ALL TO PUBLIC USING (${isolation("uuid")}) WITH CHECK (${isolation("uuid")});`,
      `DROP POLICY IF EXISTS "kumiko_system_tenant_read" ON "store_items";`,
      `CREATE POLICY "kumiko_system_tenant_read" ON "store_items" AS PERMISSIVE FOR SELECT TO PUBLIC USING ("tenant_id" = '${SYSTEM}'::uuid AND NULLIF(current_setting('kumiko.tenant_id', true), '') IS NOT NULL);`,
      `ALTER TABLE "store_items" ENABLE ROW LEVEL SECURITY;`,
      `ALTER TABLE "store_items" FORCE ROW LEVEL SECURITY;`,
    ]);
  });

  test("casts to text for a text tenant_id", () => {
    const statements = renderTableRowLevelSecurityDdl(tenantMeta("store_text", "text"));
    expect(statements[1]).toContain(`::text OR current_setting`);
    expect(statements[3]).toContain(`'${SYSTEM}'::text AND`);
    expect(statements.join("\n")).not.toContain("::uuid");
  });

  test("renders nothing for a table without tenant_id", () => {
    expect(renderTableRowLevelSecurityDdl(globalMeta)).toEqual([]);
    expect(tenantRowLevelSecurityFor(globalMeta)).toBeUndefined();
  });

  test("quotes table names containing a double quote", () => {
    const statements = renderTableRowLevelSecurityDdl(tenantMeta('odd"name'));
    expect(statements.every((s) => s.includes(`"odd""name"`))).toBe(true);
  });
});

describe("renderTableDdl with rowLevelSecurity", () => {
  const meta = tenantMeta("store_items");

  test("on appends the policy statements to the plain DDL", () => {
    expect(renderTableDdl(meta, { rowLevelSecurity: "on" })).toEqual([
      ...renderTableDdl(meta),
      ...renderTableRowLevelSecurityDdl(meta),
    ]);
  });

  test("without option and with off the output is the plain DDL", () => {
    const plain = renderTableDdl(meta);
    expect(plain).toHaveLength(1);
    expect(renderTableDdl(meta, { rowLevelSecurity: "off" })).toEqual(plain);
    expect(renderTablesDdl([meta, globalMeta])).toEqual([
      ...renderTableDdl(meta),
      ...renderTableDdl(globalMeta),
    ]);
  });

  test("renderTablesDdl passes the mode to every table", () => {
    const statements = renderTablesDdl([meta, globalMeta], { rowLevelSecurity: "on" });
    expect(statements.filter((s) => s.startsWith("CREATE POLICY"))).toHaveLength(2);
  });
});

describe("policy helpers", () => {
  test("rowLevelSecurityByTable keeps only tables with a spec", () => {
    const byTable = rowLevelSecurityByTable([tenantMeta("b"), globalMeta, tenantMeta("a")]);
    expect(Object.keys(byTable)).toEqual(["b", "a"]);
  });

  test("renderCreatePolicy omits missing USING and WITH CHECK", () => {
    expect(
      renderCreatePolicy('public."t"', {
        name: "p",
        command: "UPDATE",
        kind: "RESTRICTIVE",
        rolesSql: "app_role",
      }),
    ).toBe(`CREATE POLICY "p" ON public."t" AS RESTRICTIVE FOR UPDATE TO app_role;`);
  });

  test("renderRowLevelSecurityFlags renders both directions", () => {
    expect(renderRowLevelSecurityFlags('"t"', { enabled: false, forced: false })).toEqual([
      `ALTER TABLE "t" DISABLE ROW LEVEL SECURITY;`,
      `ALTER TABLE "t" NO FORCE ROW LEVEL SECURITY;`,
    ]);
  });

  test("enable drops policies that vanished from the new spec", () => {
    const previous = { policies: [{ ...policyStub("old") }, { ...policyStub("kept") }] };
    const next = { policies: [{ ...policyStub("kept") }] };
    const statements = renderEnableRowLevelSecurity('"t"', next, previous);
    expect(statements[0]).toBe(`DROP POLICY IF EXISTS "old" ON "t";`);
    expect(statements.filter((s) => s.startsWith("CREATE POLICY"))).toHaveLength(1);
    expect(statements.slice(-2)).toEqual([
      `ALTER TABLE "t" ENABLE ROW LEVEL SECURITY;`,
      `ALTER TABLE "t" FORCE ROW LEVEL SECURITY;`,
    ]);
  });

  test("disable drops policies and unforces before disabling", () => {
    expect(renderDisableRowLevelSecurity('"t"', { policies: [policyStub("p")] })).toEqual([
      `DROP POLICY IF EXISTS "p" ON "t";`,
      `ALTER TABLE "t" NO FORCE ROW LEVEL SECURITY;`,
      `ALTER TABLE "t" DISABLE ROW LEVEL SECURITY;`,
    ]);
  });
});

function policyStub(name: string) {
  return {
    name,
    command: "ALL" as const,
    kind: "PERMISSIVE" as const,
    rolesSql: "PUBLIC",
    using: "true",
  };
}

describe("isTableRowLevelSecurityRecord", () => {
  test("accepts generated specs", () => {
    expect(isTableRowLevelSecurityRecord(rowLevelSecurityByTable([tenantMeta("a")]))).toBe(true);
    expect(isTableRowLevelSecurityRecord({})).toBe(true);
  });

  test.each([
    ["non-object", 5],
    ["entry without policies", { a: {} }],
    ["unknown command", { a: { policies: [{ ...policyStub("p"), command: "TRUNCATE" }] } }],
    ["unknown kind", { a: { policies: [{ ...policyStub("p"), kind: "MAYBE" }] } }],
    ["non-string using", { a: { policies: [{ ...policyStub("p"), using: 1 }] } }],
    ["missing name", { a: { policies: [{ command: "ALL", kind: "PERMISSIVE", rolesSql: "x" }] } }],
  ])("rejects %s", (_label, value) => {
    expect(isTableRowLevelSecurityRecord(value)).toBe(false);
  });
});
