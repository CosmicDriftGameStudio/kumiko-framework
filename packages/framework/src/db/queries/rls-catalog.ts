// Reads and restores a table's row level security state from the Postgres catalog.
// The shadow swap rebuilds a table from EntityTableMeta, which carries no policies:
// the live state is read before the swap and re-applied (then verified) afterwards.

import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import { type AnyDb, asRawClient } from "../query.ts";
import {
  POLICY_COMMANDS,
  POLICY_KINDS,
  type RowLevelSecurityFlags,
  type RowLevelSecurityPolicy,
  renderCreatePolicy,
  renderRowLevelSecurityFlags,
  type TableRowLevelSecurity,
} from "../render-rls-ddl.ts";
import { quoteTableIdent } from "./table-ops.ts";

export type RowLevelSecurityState = RowLevelSecurityFlags & TableRowLevelSecurity;

type FlagsRow = { relrowsecurity: boolean; relforcerowsecurity: boolean };

type PolicyRow = {
  policyname: string;
  permissive: string;
  cmd: string;
  qual: string | null;
  with_check: string | null;
  roles_sql: string;
};

function toPolicy(row: PolicyRow): RowLevelSecurityPolicy {
  if (!isOneOf(POLICY_COMMANDS, row.cmd) || !isOneOf(POLICY_KINDS, row.permissive)) {
    throw new Error(
      `row level security: policy "${row.policyname}" has unsupported command "${row.cmd}" or kind "${row.permissive}"`,
    );
  }
  return {
    name: row.policyname,
    command: row.cmd,
    kind: row.permissive,
    rolesSql: row.roles_sql,
    ...(row.qual !== null && { using: row.qual }),
    ...(row.with_check !== null && { withCheck: row.with_check }),
  };
}

export async function readRowLevelSecurityState(
  db: AnyDb,
  schemaName: string,
  tableName: string,
): Promise<RowLevelSecurityState | undefined> {
  const raw = asRawClient(db);
  const flagRows = await raw.unsafe<FlagsRow>(
    `SELECT c.relrowsecurity, c.relforcerowsecurity
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relname = $2`,
    [schemaName, tableName],
  );
  const flags = flagRows[0];
  if (flags === undefined) return undefined;
  const policyRows = await raw.unsafe<PolicyRow>(
    `SELECT policyname, permissive, cmd, qual, with_check,
       array_to_string(ARRAY(SELECT CASE WHEN r = 'public' THEN 'PUBLIC' ELSE quote_ident(r) END
         FROM unnest(roles) AS r ORDER BY r::text COLLATE "C"), ', ') AS roles_sql
     FROM pg_policies WHERE schemaname = $1 AND tablename = $2
     ORDER BY policyname COLLATE "C"`,
    [schemaName, tableName],
  );
  return {
    enabled: flags.relrowsecurity,
    forced: flags.relforcerowsecurity,
    policies: policyRows.map(toPolicy),
  };
}

function describePolicyDifference(
  expected: RowLevelSecurityPolicy,
  actual: RowLevelSecurityPolicy | undefined,
): string | undefined {
  if (actual === undefined) return `policy ${expected.name} missing`;
  const fields = ["command", "kind", "rolesSql", "using", "withCheck"] as const;
  const differing = fields.filter((field) => expected[field] !== actual[field]);
  return differing.length > 0
    ? `policy ${expected.name} differs in ${differing.join(", ")}`
    : undefined;
}

export function describeRowLevelSecurityDifference(
  expected: RowLevelSecurityState,
  actual: RowLevelSecurityState | undefined,
): string | undefined {
  if (actual === undefined) return "table missing";
  const differences: string[] = [];
  if (expected.enabled !== actual.enabled)
    differences.push(`enabled ${expected.enabled} -> ${actual.enabled}`);
  if (expected.forced !== actual.forced)
    differences.push(`forced ${expected.forced} -> ${actual.forced}`);
  const actualByName = new Map(actual.policies.map((policy) => [policy.name, policy]));
  for (const policy of expected.policies) {
    const difference = describePolicyDifference(policy, actualByName.get(policy.name));
    if (difference !== undefined) differences.push(difference);
  }
  const expectedNames = new Set(expected.policies.map((policy) => policy.name));
  for (const policy of actual.policies) {
    if (!expectedNames.has(policy.name)) differences.push(`unexpected policy ${policy.name}`);
  }
  return differences.length > 0 ? differences.join("; ") : undefined;
}

export async function restoreRowLevelSecurityState(
  tx: AnyDb,
  tableName: string,
  expected: RowLevelSecurityState,
): Promise<void> {
  const raw = asRawClient(tx);
  const tableSql = `public.${quoteTableIdent(tableName)}`;
  for (const policy of expected.policies) {
    await raw.unsafe(renderCreatePolicy(tableSql, policy));
  }
  for (const statement of renderRowLevelSecurityFlags(tableSql, expected)) {
    await raw.unsafe(statement);
  }
  const difference = describeRowLevelSecurityDifference(
    expected,
    await readRowLevelSecurityState(tx, "public", tableName),
  );
  if (difference !== undefined) {
    throw new Error(
      `shadow swap: row level security of public.${tableName} differs after the swap: ${difference}`,
    );
  }
}
