// Pure renderer for Postgres row level security: EntityTableMeta → policy DDL.
// Every table with a `tenant_id` column gets two policies; tables without one are untouched.

import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-types/identifiers";
import { isOneOf, isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { pgTypeToSqlType } from "./dialect.ts";
import type { EntityTableMeta } from "./entity-table-meta.ts";
import { quoteIdent } from "./sql-identifier.ts";

export const ROW_LEVEL_SECURITY_MODES = ["off", "on"] as const;
export type RowLevelSecurityMode = (typeof ROW_LEVEL_SECURITY_MODES)[number];

export const TENANT_ISOLATION_POLICY = "kumiko_tenant_isolation";
export const SYSTEM_TENANT_READ_POLICY = "kumiko_system_tenant_read";
export const TENANT_ID_SETTING = "kumiko.tenant_id";
export const SCOPE_SETTING = "kumiko.scope";
export const SYSTEM_SCOPE = "system";

const TENANT_COLUMN = "tenant_id";

export const POLICY_COMMANDS = ["ALL", "SELECT", "INSERT", "UPDATE", "DELETE"] as const;
export const POLICY_KINDS = ["PERMISSIVE", "RESTRICTIVE"] as const;

export type RowLevelSecurityPolicy = {
  readonly name: string;
  readonly command: (typeof POLICY_COMMANDS)[number];
  readonly kind: (typeof POLICY_KINDS)[number];
  readonly rolesSql: string;
  readonly using?: string;
  readonly withCheck?: string;
};

export type TableRowLevelSecurity = { readonly policies: readonly RowLevelSecurityPolicy[] };

export type RowLevelSecurityFlags = { readonly enabled: boolean; readonly forced: boolean };

export function tenantRowLevelSecurityFor(
  meta: EntityTableMeta,
): TableRowLevelSecurity | undefined {
  const tenantColumn = meta.columns.find((col) => col.name === TENANT_COLUMN);
  if (tenantColumn === undefined) return undefined;
  const sqlType = pgTypeToSqlType(tenantColumn.pgType);
  const column = quoteIdent(TENANT_COLUMN);
  // NULLIF: after a transaction-local set_config, current_setting returns '' instead of NULL.
  const sessionTenant = `NULLIF(current_setting('${TENANT_ID_SETTING}', true), '')`;
  const isolation = `${column} = ${sessionTenant}::${sqlType} OR current_setting('${SCOPE_SETTING}', true) = '${SYSTEM_SCOPE}'`;
  return {
    policies: [
      {
        name: TENANT_ISOLATION_POLICY,
        command: "ALL",
        kind: "PERMISSIVE",
        rolesSql: "PUBLIC",
        using: isolation,
        withCheck: isolation,
      },
      {
        name: SYSTEM_TENANT_READ_POLICY,
        command: "SELECT",
        kind: "PERMISSIVE",
        rolesSql: "PUBLIC",
        using: `${column} = '${SYSTEM_TENANT_ID}'::${sqlType} AND ${sessionTenant} IS NOT NULL`,
      },
    ],
  };
}

export function rowLevelSecurityByTable(
  metas: readonly EntityTableMeta[],
): Record<string, TableRowLevelSecurity> {
  const byTable: Record<string, TableRowLevelSecurity> = {};
  for (const meta of metas) {
    const spec = tenantRowLevelSecurityFor(meta);
    if (spec !== undefined) byTable[meta.tableName] = spec;
  }
  return byTable;
}

export function renderCreatePolicy(tableSql: string, policy: RowLevelSecurityPolicy): string {
  const using = policy.using !== undefined ? ` USING (${policy.using})` : "";
  const withCheck = policy.withCheck !== undefined ? ` WITH CHECK (${policy.withCheck})` : "";
  return `CREATE POLICY ${quoteIdent(policy.name)} ON ${tableSql} AS ${policy.kind} FOR ${policy.command} TO ${policy.rolesSql}${using}${withCheck};`;
}

function renderDropPolicy(tableSql: string, policyName: string): string {
  return `DROP POLICY IF EXISTS ${quoteIdent(policyName)} ON ${tableSql};`;
}

export function renderRowLevelSecurityFlags(
  tableSql: string,
  flags: RowLevelSecurityFlags,
): string[] {
  return [
    `ALTER TABLE ${tableSql} ${flags.enabled ? "ENABLE" : "DISABLE"} ROW LEVEL SECURITY;`,
    `ALTER TABLE ${tableSql} ${flags.forced ? "FORCE" : "NO FORCE"} ROW LEVEL SECURITY;`,
  ];
}

export function renderEnableRowLevelSecurity(
  tableSql: string,
  next: TableRowLevelSecurity,
  previous?: TableRowLevelSecurity,
): string[] {
  const nextNames = new Set(next.policies.map((policy) => policy.name));
  const vanished = (previous?.policies ?? []).filter((policy) => !nextNames.has(policy.name));
  return [
    ...vanished.map((policy) => renderDropPolicy(tableSql, policy.name)),
    ...next.policies.flatMap((policy) => [
      renderDropPolicy(tableSql, policy.name),
      renderCreatePolicy(tableSql, policy),
    ]),
    ...renderRowLevelSecurityFlags(tableSql, { enabled: true, forced: true }),
  ];
}

export function renderDisableRowLevelSecurity(
  tableSql: string,
  previous: TableRowLevelSecurity,
): string[] {
  return [
    ...previous.policies.map((policy) => renderDropPolicy(tableSql, policy.name)),
    ...renderRowLevelSecurityFlags(tableSql, { enabled: false, forced: false }).reverse(),
  ];
}

export function renderTableRowLevelSecurityDdl(meta: EntityTableMeta): readonly string[] {
  const spec = tenantRowLevelSecurityFor(meta);
  if (spec === undefined) return [];
  return renderEnableRowLevelSecurity(quoteIdent(meta.tableName), spec);
}

function isSamePolicy(a: RowLevelSecurityPolicy, b: RowLevelSecurityPolicy): boolean {
  return (
    a.name === b.name &&
    a.command === b.command &&
    a.kind === b.kind &&
    a.rolesSql === b.rolesSql &&
    a.using === b.using &&
    a.withCheck === b.withCheck
  );
}

export function isSameTableRowLevelSecurity(
  a: TableRowLevelSecurity,
  b: TableRowLevelSecurity,
): boolean {
  return (
    a.policies.length === b.policies.length &&
    a.policies.every((policy, index) => {
      const other = b.policies[index];
      return other !== undefined && isSamePolicy(policy, other);
    })
  );
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isRowLevelSecurityPolicy(value: unknown): value is RowLevelSecurityPolicy {
  return (
    isPlainObject(value) &&
    typeof value["name"] === "string" &&
    typeof value["rolesSql"] === "string" &&
    isOneOf(POLICY_COMMANDS, value["command"]) &&
    isOneOf(POLICY_KINDS, value["kind"]) &&
    isOptionalString(value["using"]) &&
    isOptionalString(value["withCheck"])
  );
}

function isTableRowLevelSecurity(value: unknown): value is TableRowLevelSecurity {
  return (
    isPlainObject(value) &&
    Array.isArray(value["policies"]) &&
    value["policies"].every(isRowLevelSecurityPolicy)
  );
}

export function isTableRowLevelSecurityRecord(
  value: unknown,
): value is Record<string, TableRowLevelSecurity> {
  return isPlainObject(value) && Object.values(value).every(isTableRowLevelSecurity);
}
