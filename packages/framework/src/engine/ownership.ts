// Ownership rules — the declarative bridge between Claims and Access.
//
// Every ownership rule answers the same question: "May this user see / write
// this row (or field in this row)?". The rule is evaluated per-role: a user
// with multiple roles passes if at least one of their roles has a rule that
// accepts the row. For writes, the check is stricter — see below.
//
// Rule forms:
//
//   "all"                                → any user with this role passes
//   { from: "user:id", column: "..." }   → row[column] === user.id
//   { from: "claim:<featureQn>",
//     column?: "..." }                   → row[column ?? claim.shortName] === user.claims[claim.qn]
//                                         (string[] claim → inArray)
//   { where: (user, ctx) => SqlFragment } → escape hatch, raw parameterised SQL
//
// Construction: use the `from(ref, column?)` helper. It returns a FromRule
// ready to drop into an access map.

import { toSnakeCase } from "../db/table-builder";
import type { SessionUser } from "./types";

// Types live in engine/types/ownership.ts (no runtime dependency); re-exported
// here for backwards compatibility with existing importers of this file.
export type {
  FromRule,
  FromRuleKind,
  OwnershipClause,
  OwnershipMap,
  OwnershipRef,
  OwnershipRule,
  SqlFragment,
  WhereRule,
  WhereRuleContext,
} from "./types/ownership";

import type {
  FromRule,
  OwnershipClause,
  OwnershipMap,
  OwnershipRef,
  OwnershipRule,
  SqlFragment,
} from "./types/ownership";

// Parse an OwnershipRef into kind + resolved path + default column.
// Throws on malformed input so the error surfaces at `from()`-call-site (in
// the feature definition), not at request time.
export function from(ref: OwnershipRef, column?: string): FromRule {
  const firstColon = ref.indexOf(":");
  if (firstColon < 0) {
    throw new Error(
      `from("${ref}"): expected "user:<field>" or "claim:<featureName>:<key>" — no colon found.`,
    );
  }
  const prefix = ref.slice(0, firstColon);
  const rest = ref.slice(firstColon + 1);

  if (prefix === "user") {
    // "user:id" or "user:tenantId". The rest is the user-property; the
    // column on the row must be given explicitly (a user.id is rarely
    // named `id` on a child table — usually `ownerId`, `assigneeId`, ...).
    if (!column) {
      throw new Error(
        `from("${ref}"): user-refs require an explicit column name — e.g. from("user:id", "assigneeId").`,
      );
    }
    if (rest !== "id" && rest !== "tenantId") {
      throw new Error(
        `from("${ref}"): user-ref supports only "user:id" or "user:tenantId" (got "user:${rest}").`,
      );
    }
    return { kind: "from", refKind: "user", refPath: rest, column };
  }

  if (prefix === "claim") {
    // "claim:<feature>:<key>" — rest is the 2-segment claim QN.
    if (!rest.includes(":")) {
      throw new Error(
        `from("${ref}"): claim-ref must be "claim:<featureName>:<shortName>" (got "claim:${rest}").`,
      );
    }
    // Default column = claim shortName (second segment).
    const defaultColumn = rest.slice(rest.indexOf(":") + 1);
    return {
      kind: "from",
      refKind: "claim",
      refPath: rest, // full QN, matches the key in user.claims
      column: column ?? defaultColumn,
    };
  }

  throw new Error(
    `from("${ref}"): unsupported ref prefix "${prefix}". Supported: "user", "claim".`,
  );
}

// Evaluate an ownership rule against a concrete row (plain data, no Drizzle).
// Used by field-level filters on query responses and by field-level
// write-checks. Entity-level rules that want SQL predicates go through
// buildOwnershipClause() (separate path, since that produces Drizzle SQL).
//
// Null/undefined claim values evaluate to `false` (no match) — safer than
// letting them match rows where the column happens to be null.
export function matchesRule(
  rule: OwnershipRule,
  user: SessionUser,
  row: Readonly<Record<string, unknown>>,
): boolean {
  if (rule === "all") return true;
  if (rule.kind === "where") {
    // `where` rules produce Drizzle SQL for the DB-side filter. They don't
    // have a straightforward in-memory evaluator — the feature author owns
    // the semantics. Field-level filters can't use `{ where }` rules; the
    // boot-validator rejects them with a clear error at registration time.
    throw new Error(
      "where-rules can only be evaluated at the SQL layer; boot-validator should reject them on field-level access.",
    );
  }

  // FromRule — resolve the user-side value, compare to the row's column.
  const userValue = resolveUserValue(rule, user);
  if (userValue === undefined) return false;

  const rowValue = row[rule.column];
  if (rowValue === undefined || rowValue === null) return false;

  // Array claim → membership check; scalar claim → equality.
  if (Array.isArray(userValue)) {
    return userValue.includes(rowValue);
  }
  return userValue === rowValue;
}

function resolveUserValue(rule: FromRule, user: SessionUser): unknown {
  if (rule.refKind === "user") {
    if (rule.refPath === "id") return user.id;
    return user.tenantId;
  }
  // claim refPath is the full QN ("feature:shortName") — direct key lookup.
  return user.claims?.[rule.refPath];
}

// Multi-role-atomic passer for field-level READ. The caller supplies the
// user, the access-map for this field, and the concrete row. Returns true
// if AT LEAST one of the user's roles is in the map and its rule matches
// the row. Missing roles skip, "all" always passes.
export function userCanReadFieldRow(
  user: SessionUser,
  accessMap: OwnershipMap | undefined,
  row: Readonly<Record<string, unknown>>,
): boolean {
  if (!accessMap || Object.keys(accessMap).length === 0) return true; // public
  for (const role of user.roles) {
    const rule = accessMap[role];
    if (!rule) continue;
    if (matchesRule(rule, user, row)) return true;
  }
  return false;
}

// Multi-role-atomic check for field-level WRITE with Straddle-prevention.
// A user passes iff exactly one of their roles has a rule that accepts
// BOTH the old and the new row. OR-ing over (any-role passes old) and
// (any-role passes new) is wrong — a user with two roles could split the
// check: role A validates the old, role B validates the new, yielding
// row-grabbing by stitching two rules together. See advisor review 2026-04-19.
export function userCanWriteFieldRow(
  user: SessionUser,
  accessMap: OwnershipMap | undefined,
  oldRow: Readonly<Record<string, unknown>>,
  newRow: Readonly<Record<string, unknown>>,
): boolean {
  if (!accessMap || Object.keys(accessMap).length === 0) return true; // public
  for (const role of user.roles) {
    const rule = accessMap[role];
    if (!rule) continue;
    if (rule === "all") return true;
    if (matchesRule(rule, user, oldRow) && matchesRule(rule, user, newRow)) return true;
  }
  return false;
}

// Normalize legacy `readonly string[]` field-access into the OwnershipMap
// shape. Each role in the array becomes a key with rule "all" (unrestricted
// for that role). Undefined stays undefined. This is a migration shim —
// long-term every feature-definition writes the map shape directly.
export function normalizeAccessEntry(
  entry: OwnershipMap | readonly string[] | undefined,
): OwnershipMap | undefined {
  if (!entry) return undefined;
  if (Array.isArray(entry)) {
    if (entry.length === 0) return undefined;
    const map: Record<string, OwnershipRule> = {};
    for (const role of entry) {
      map[role] = "all";
    }
    return map;
  }
  return entry as OwnershipMap; // @cast-boundary schema-walk
}

// Create-case: only the new row exists. Same Straddle protection not
// applicable (no old row to compare), but we still need per-role atomicity
// to respect "all"-rules and plain from-rules consistently.
export function userCanCreateFieldRow(
  user: SessionUser,
  accessMap: OwnershipMap | undefined,
  newRow: Readonly<Record<string, unknown>>,
): boolean {
  if (!accessMap || Object.keys(accessMap).length === 0) return true;
  for (const role of user.roles) {
    const rule = accessMap[role];
    if (!rule) continue;
    if (rule === "all") return true;
    if (matchesRule(rule, user, newRow)) return true;
  }
  return false;
}

const PASS_CLAUSE: OwnershipClause = { kind: "pass" };
const EMPTY_CLAUSE: OwnershipClause = { kind: "empty" };

const KUMIKO_NAME_SYMBOL = Symbol.for("kumiko:schema:Name");
const KUMIKO_COLUMNS_SYMBOL = Symbol.for("kumiko:schema:Columns");

function tableNameOf(table: unknown): string {
  if (table !== null && typeof table === "object") {
    const sym = (table as Record<symbol, unknown>)[KUMIKO_NAME_SYMBOL];
    if (typeof sym === "string") return sym;
  }
  return "<unknown>";
}

// Resolve a JS-field name on the table to its underlying SQL column name.
// Drizzle tables carry the mapping under Symbol.for("kumiko:schema:Columns");
// we read it without importing drizzle-orm at runtime.
function columnSqlName(table: unknown, field: string): string | null {
  if (table === null || typeof table !== "object") return null;
  const cols = (table as Record<symbol, unknown>)[KUMIKO_COLUMNS_SYMBOL];
  if (cols && typeof cols === "object") {
    const col = (cols as Record<string, unknown>)[field];
    if (col && typeof col === "object") {
      const nameVal = (col as Record<string, unknown>)["name"];
      if (typeof nameVal === "string") return nameVal;
    }
  }
  // Field may already be the SQL column name on plain objects (tests, etc.).
  if ((table as Record<string, unknown>)[field] !== undefined) {
    return toSnakeCase(field);
  }
  return null;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

// Shift `$N` placeholder numbers in an embedded fragment so they line up
// with the outer query's param array.
export function shiftParams(fragment: SqlFragment, shift: number): SqlFragment {
  if (shift === 0) return fragment;
  const sqlText = fragment.sqlText.replace(/\$(\d+)/g, (_, num) => `$${Number(num) + shift}`);
  return { sqlText, params: fragment.params };
}

// Build an ownership clause for entity-level READ access. Caller weaves
// the result into a raw-SQL WHERE (see event-store-executor list/getById).
//
// `table` is the (drizzle or compatible) table object; we extract column
// SQL names via the kumiko:schema:Columns symbol. Unknown column on a from-rule
// is a boot-time misconfiguration; at request time we treat it as empty
// (safe default) rather than passing silently.
export function buildOwnershipClause(
  user: SessionUser,
  accessMap: OwnershipMap | undefined,
  table: unknown,
  paramStart = 1,
): OwnershipClause {
  if (!accessMap || Object.keys(accessMap).length === 0) return PASS_CLAUSE;

  const clauses: SqlFragment[] = [];
  let anyRoleMatched = false;
  let everyRuleCollapsedToEmpty = true;
  let nextParamIdx = paramStart;

  for (const role of user.roles) {
    const rule = accessMap[role];
    if (!rule) continue;
    anyRoleMatched = true;
    if (rule === "all") return PASS_CLAUSE;
    const resolved = ruleToFragment(rule, user, table, nextParamIdx);
    if (resolved.kind === "sql") {
      clauses.push({ sqlText: resolved.sqlText, params: resolved.params });
      nextParamIdx += resolved.params.length;
      everyRuleCollapsedToEmpty = false;
    }
  }

  if (!anyRoleMatched) return EMPTY_CLAUSE;
  if (everyRuleCollapsedToEmpty && clauses.length === 0) return EMPTY_CLAUSE;
  if (clauses.length === 1) {
    const only = clauses[0];
    if (!only) return EMPTY_CLAUSE;
    return { kind: "sql", sqlText: `(${only.sqlText})`, params: only.params };
  }
  const sqlText = clauses.map((c) => `(${c.sqlText})`).join(" OR ");
  const params: unknown[] = [];
  for (const c of clauses) for (const p of c.params) params.push(p);
  return { kind: "sql", sqlText: `(${sqlText})`, params };
}

type RuleFragmentResult =
  | { readonly kind: "empty" }
  | { readonly kind: "sql"; readonly sqlText: string; readonly params: readonly unknown[] };

function ruleToFragment(
  rule: OwnershipRule,
  user: SessionUser,
  table: unknown,
  paramStart: number,
): RuleFragmentResult {
  if (rule === "all") {
    return { kind: "sql", sqlText: "TRUE", params: [] };
  }
  if (rule.kind === "where") {
    const frag = rule.where(user, {
      table,
      tableName: tableNameOf(table),
      paramStart,
    });
    return { kind: "sql", sqlText: frag.sqlText, params: frag.params };
  }
  // FromRule
  const colName = columnSqlName(table, rule.column);
  if (!colName) return { kind: "empty" };

  const value = resolveUserValue(rule, user);
  if (value === undefined || value === null) return { kind: "empty" };

  if (Array.isArray(value)) {
    if (value.length === 0) return { kind: "empty" };
    const placeholders = value.map((_, i) => `$${paramStart + i}`).join(", ");
    return {
      kind: "sql",
      sqlText: `${quoteIdent(colName)} IN (${placeholders})`,
      params: value,
    };
  }
  return {
    kind: "sql",
    sqlText: `${quoteIdent(colName)} = $${paramStart}`,
    params: [value],
  };
}
