// Row level security part of the migration replay: tracks ENABLE/FORCE flags and
// policy names per table so they can be compared against the snapshot.

import type { TableRowLevelSecurity } from "./render-rls-ddl.ts";

export type ReplayedRowLevelSecurity = {
  readonly enabled: boolean;
  readonly forced: boolean;
  readonly policies: ReadonlySet<string>;
};

export type MutableReplayedRowLevelSecurity = {
  enabled: boolean;
  forced: boolean;
  policies: Set<string>;
};

type TableWithRowLevelSecurity = { rowLevelSecurity?: MutableReplayedRowLevelSecurity };

const IDENT = `"?([^"\\s(;,.]+)"?`;
const TABLE_REF = `(?:"?public"?\\.)?${IDENT}`;

const ALTER_TABLE_RE = new RegExp(
  `^ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${TABLE_REF}\\s+([\\s\\S]*?);?\\s*$`,
  "i",
);
const FLAG_CLAUSE_RE = /\b(ENABLE|DISABLE|NO\s+FORCE|FORCE)\s+ROW\s+LEVEL\s+SECURITY\b/gi;
const CREATE_POLICY_RE = new RegExp(
  `^CREATE\\s+POLICY\\s+${IDENT}\\s+ON\\s+${TABLE_REF}(?=[\\s;]|$)`,
  "i",
);
const DROP_POLICY_RE = new RegExp(
  `^DROP\\s+POLICY\\s+(IF\\s+EXISTS\\s+)?${IDENT}\\s+ON\\s+${TABLE_REF}(?=[\\s;]|$)`,
  "i",
);
const ALTER_POLICY_RE = new RegExp(
  `^ALTER\\s+POLICY\\s+${IDENT}\\s+ON\\s+${TABLE_REF}(?=[\\s;]|$)([\\s\\S]*)$`,
  "i",
);
const RENAME_POLICY_RE = new RegExp(`^\\s*RENAME\\s+TO\\s+${IDENT}\\s*;?\\s*$`, "i");
const ANY_POLICY_STATEMENT_RE = /^(CREATE|ALTER|DROP)\s+POLICY\b/i;

function stateOf(table: TableWithRowLevelSecurity): MutableReplayedRowLevelSecurity {
  table.rowLevelSecurity ??= { enabled: false, forced: false, policies: new Set<string>() };
  return table.rowLevelSecurity;
}

function applyFlagClauses(table: TableWithRowLevelSecurity, alterBody: string): void {
  for (const [, clause] of alterBody.matchAll(FLAG_CLAUSE_RE)) {
    const state = stateOf(table);
    switch (clause?.toUpperCase().replace(/\s+/g, " ")) {
      case "ENABLE":
        state.enabled = true;
        break;
      case "DISABLE":
        state.enabled = false;
        break;
      case "FORCE":
        state.forced = true;
        break;
      case "NO FORCE":
        state.forced = false;
        break;
    }
  }
}

function applyAlterPolicy(
  table: TableWithRowLevelSecurity,
  policyName: string,
  alterBody: string,
): void {
  const newName = alterBody.match(RENAME_POLICY_RE)?.[1];
  if (newName === undefined) return;
  const state = stateOf(table);
  if (state.policies.delete(policyName)) state.policies.add(newName);
}

function failUnparsedPolicy(statement: string, file: string): never {
  const prefix = statement.slice(0, 200).replace(/\s+/g, " ").trim();
  throw new Error(
    `replayMigrationsDir: unparsed policy statement in ${file} — expected CREATE POLICY <name> ON <table>, ` +
      `DROP POLICY [IF EXISTS] <name> ON <table> or ALTER POLICY <name> ON <table>. Statement: ${prefix}${statement.length > 200 ? "…" : ""}`,
  );
}

type StatementContext = { readonly file: string };
type ReplayTables = ReadonlyMap<string, TableWithRowLevelSecurity>;

function tryApplyAlterTable(tables: ReplayTables, statement: string): boolean {
  const alter = statement.match(ALTER_TABLE_RE);
  if (alter?.[1] === undefined || alter[2] === undefined) return false;
  const table = tables.get(alter[1]);
  if (table) applyFlagClauses(table, alter[2]);
  return true;
}

function tryApplyCreatePolicy(tables: ReplayTables, statement: string): boolean {
  const created = statement.match(CREATE_POLICY_RE);
  if (created?.[1] === undefined || created[2] === undefined) return false;
  const table = tables.get(created[2]);
  if (table) stateOf(table).policies.add(created[1]);
  return true;
}

function tryApplyDropPolicy(
  tables: ReplayTables,
  statement: string,
  context: StatementContext,
): boolean {
  const dropped = statement.match(DROP_POLICY_RE);
  if (dropped?.[2] === undefined || dropped[3] === undefined) return false;
  const table = tables.get(dropped[3]);
  if (!table) return true;
  const removed = stateOf(table).policies.delete(dropped[2]);
  if (!removed && dropped[1] === undefined) {
    throw new Error(
      `replayMigrationsDir: ${context.file} drops policy "${dropped[2]}" on "${dropped[3]}" which no earlier migration created`,
    );
  }
  return true;
}

function tryApplyAlterPolicy(tables: ReplayTables, statement: string): boolean {
  const altered = statement.match(ALTER_POLICY_RE);
  if (altered?.[1] === undefined || altered[2] === undefined || altered[3] === undefined) {
    return false;
  }
  const table = tables.get(altered[2]);
  if (table) applyAlterPolicy(table, altered[1], altered[3]);
  return true;
}

export function applyRowLevelSecurityStatement(
  tables: ReplayTables,
  statement: string,
  context: StatementContext,
): void {
  const handled =
    tryApplyAlterTable(tables, statement) ||
    tryApplyCreatePolicy(tables, statement) ||
    tryApplyDropPolicy(tables, statement, context) ||
    tryApplyAlterPolicy(tables, statement);
  if (!handled && ANY_POLICY_STATEMENT_RE.test(statement)) {
    failUnparsedPolicy(statement, context.file);
  }
}

export function rowLevelSecurityDrift(
  replayed: ReplayedRowLevelSecurity | undefined,
  expected: TableRowLevelSecurity,
): string | undefined {
  const parts: string[] = [];
  if (replayed?.enabled !== true) parts.push("ROW LEVEL SECURITY is not enabled");
  if (replayed?.forced !== true) parts.push("ROW LEVEL SECURITY is not forced");
  const expectedNames = expected.policies.map((policy) => policy.name);
  const actualNames = replayed?.policies ?? new Set<string>();
  const missing = expectedNames.filter((name) => !actualNames.has(name));
  const unexpected = [...actualNames].filter((name) => !expectedNames.includes(name));
  if (missing.length > 0) parts.push(`missing policies: ${missing.join(", ")}`);
  if (unexpected.length > 0) parts.push(`unexpected policies: ${unexpected.join(", ")}`);
  return parts.length > 0 ? parts.join("; ") : undefined;
}
