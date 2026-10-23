// Row level security part of the migration replay: tracks ENABLE/FORCE flags and
// policy definitions per table so they can be compared against the snapshot.

import { renderCreatePolicy, type TableRowLevelSecurity } from "./render-rls-ddl.ts";
import { quoteIdent } from "./sql-identifier.ts";

// Normalized text after `ON <table>`; undefined once an ALTER POLICY changed it in a way the replay cannot follow.
export type ReplayedPolicies = ReadonlyMap<string, string | undefined>;

export type ReplayedRowLevelSecurity = {
  readonly enabled: boolean;
  readonly forced: boolean;
  readonly policies: ReplayedPolicies;
};

export type MutableReplayedRowLevelSecurity = {
  enabled: boolean;
  forced: boolean;
  policies: Map<string, string | undefined>;
};

type TableWithRowLevelSecurity = { rowLevelSecurity?: MutableReplayedRowLevelSecurity };

// Identifiers in hand-written migrations aren't always quoted (the generator
// always quotes, but the header explicitly invites hand-editing) — optional
// quotes so `CREATE TABLE foo (...)` parses the same as `CREATE TABLE "foo" (...)`.
export const IDENT = `"?([^"\\s(;,.]+)"?`;
export const TABLE_REF = `(?:"?public"?\\.)?${IDENT}`;

const ALTER_TABLE_RE = new RegExp(
  `^ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${TABLE_REF}\\s+([\\s\\S]*?);?\\s*$`,
  "i",
);
const FLAG_CLAUSE_RE = /\b(ENABLE|DISABLE|NO\s+FORCE|FORCE)\s+ROW\s+LEVEL\s+SECURITY\b/gi;
const CREATE_POLICY_RE = new RegExp(
  `^CREATE\\s+POLICY\\s+${IDENT}\\s+ON\\s+${TABLE_REF}(?=[\\s;]|$)([\\s\\S]*)$`,
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
const POLICY_OR_RLS_RE = /\bPOLICY\b|ROW\s+LEVEL\s+SECURITY/i;
const ANY_POLICY_STATEMENT_RE = /^(CREATE|ALTER|DROP)\s+POLICY\b/i;

function stateOf(table: TableWithRowLevelSecurity): MutableReplayedRowLevelSecurity {
  table.rowLevelSecurity ??= {
    enabled: false,
    forced: false,
    policies: new Map<string, string | undefined>(),
  };
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

function normalizePolicyDefinition(text: string): string {
  return text.replace(/\s+/g, " ").replace(/;\s*$/, "").trim();
}

function applyAlterPolicy(
  table: TableWithRowLevelSecurity,
  policyName: string,
  alterBody: string,
): void {
  const { policies } = stateOf(table);
  const newName = alterBody.match(RENAME_POLICY_RE)?.[1];
  if (newName === undefined) {
    if (policies.has(policyName)) policies.set(policyName, undefined);
    // skip: body is not a rename, the altered-flag above is all that is tracked
    return;
  }
  // skip: policy not tracked, nothing to rename
  if (!policies.has(policyName)) return;
  policies.set(newName, policies.get(policyName));
  policies.delete(policyName);
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
  if (table) {
    stateOf(table).policies.set(created[1], normalizePolicyDefinition(created[3] ?? ""));
  }
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
  if (/^DO\b/i.test(statement) && POLICY_OR_RLS_RE.test(statement)) {
    throw new Error(
      `replayMigrationsDir: ${context.file} changes policies or row level security inside a DO block, which the replay cannot evaluate — write the statements at top level`,
    );
  }
  const handled =
    tryApplyAlterTable(tables, statement) ||
    tryApplyCreatePolicy(tables, statement) ||
    tryApplyDropPolicy(tables, statement, context) ||
    tryApplyAlterPolicy(tables, statement);
  if (!handled && ANY_POLICY_STATEMENT_RE.test(statement)) {
    failUnparsedPolicy(statement, context.file);
  }
}

function expectedPolicyDefinition(
  tableName: string,
  policy: TableRowLevelSecurity["policies"][number],
): string {
  const rendered = renderCreatePolicy(quoteIdent(tableName), policy);
  const definition = rendered.match(CREATE_POLICY_RE)?.[3];
  if (definition === undefined) {
    throw new Error(`rendered policy "${policy.name}" is not a CREATE POLICY statement`);
  }
  return normalizePolicyDefinition(definition);
}

export function rowLevelSecurityDrift(
  replayed: ReplayedRowLevelSecurity | undefined,
  tableName: string,
  expected: TableRowLevelSecurity,
): string | undefined {
  const parts: string[] = [];
  if (replayed?.enabled !== true) parts.push("ROW LEVEL SECURITY is not enabled");
  if (replayed?.forced !== true) parts.push("ROW LEVEL SECURITY is not forced");
  const actual = replayed?.policies ?? new Map<string, string | undefined>();
  const expectedNames = new Set(expected.policies.map((policy) => policy.name));
  for (const policy of expected.policies) {
    if (!actual.has(policy.name)) {
      parts.push(`missing policy: ${policy.name}`);
    } else if (actual.get(policy.name) !== expectedPolicyDefinition(tableName, policy)) {
      parts.push(
        `policy ${policy.name} deviates from the generated definition (hand-edited or altered)`,
      );
    }
  }
  const unexpected = [...actual.keys()].filter((name) => !expectedNames.has(name));
  if (unexpected.length > 0) parts.push(`unexpected policies: ${unexpected.join(", ")}`);
  return parts.length > 0 ? parts.join("; ") : undefined;
}

export function replayedOnlyRowLevelSecurityDrift(
  replayed: ReplayedRowLevelSecurity | undefined,
): string | undefined {
  const hasRowLevelSecurity =
    replayed !== undefined && (replayed.enabled || replayed.forced || replayed.policies.size > 0);
  return hasRowLevelSecurity
    ? "migrations enable row level security or create policies but .snapshot.json has no row level security spec for this table"
    : undefined;
}
