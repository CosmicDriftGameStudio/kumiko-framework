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
//   { where: (user, table) => SQL }      → escape hatch, arbitrary Drizzle predicate
//
// Construction: use the `from(ref, column?)` helper. It returns a FromRule
// ready to drop into an access map.

import { eq, inArray, or, type SQL, sql } from "drizzle-orm";
import type { SessionUser } from "./types";

// Reference spec supported by `from()`:
//   "user:id"                  → user.id
//   "user:tenantId"            → user.tenantId (rarely needed — TenantDb scopes anyway)
//   "claim:<featureName>:<key>" → user.claims["<featureName>:<key>"]
//
// The string form is keyed so the framework can look up the referenced
// Registry entry at boot (Claim-QN exists? Column type compatible?). A typed
// object form would force features to import each other's handles — the
// whole point of H.2's unified path is string-based references, no imports.
export type OwnershipRef = string;

// Resolved during `from()` — the parser eagerly splits the prefix so the
// runtime evaluator avoids string-parsing on every row. `kind` drives the
// evaluator branch; the rest is the resolved metadata.
export type FromRuleKind = "user" | "claim";

export type FromRule = {
  readonly kind: "from";
  readonly refKind: FromRuleKind;
  // For "user:id" → "id"; for "user:tenantId" → "tenantId".
  // For "claim:<featureName>:<key>" → "<featureName>:<key>" (the full QN,
  // which is exactly the key under which the JWT stores the value).
  readonly refPath: string;
  // Row-column to match against. For claim rules defaults to the claim's
  // shortName (second segment of the claim QN). For user-rules the column
  // is always explicit.
  readonly column: string;
};

export type WhereRule<TTable = unknown> = {
  readonly kind: "where";
  readonly where: (user: SessionUser, table: TTable) => SQL;
};

// "all" collapses to a primitive so map authors can write `Admin: "all"`
// without importing a helper.
export type OwnershipRule = "all" | FromRule | WhereRule;

// Per-role map: every key is a role name, value is the rule that role
// satisfies to pass the access check.
export type OwnershipMap = Readonly<Record<string, OwnershipRule>>;

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
  return entry as OwnershipMap;
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

// Result of buildOwnershipClause. The discriminant lets the caller handle
// the three outcomes without inspecting SQL internals:
//
//   "pass"  → user is unrestricted. Run the query as-is.
//   "empty" → user has a role mapped but no rule accepts any row (missing
//             claim, empty array, role not in map). Skip the DB call entirely
//             — returning [] is equivalent and avoids a pointless roundtrip.
//   "sql"   → apply `.sql` as an AND to the query's where clause.
//
// "empty" vs. "pass" is the critical distinction for a safe default:
// undefined/pass = allow, empty = deny-by-construction. Mixing them up was
// the exact leak direction advisor flagged; the disjoint type prevents it.
export type OwnershipClause =
  | { readonly kind: "pass" }
  | { readonly kind: "empty" }
  | { readonly kind: "sql"; readonly sql: SQL };

const PASS_CLAUSE: OwnershipClause = { kind: "pass" };
const EMPTY_CLAUSE: OwnershipClause = { kind: "empty" };

// Build an ownership clause for entity-level READ access. The caller
// translates the result to its query layer (see above).
//
// `table` is the Drizzle table with column objects. Unknown column on a
// from-rule is a boot-time misconfiguration; at request time we treat it
// as empty (safe default) rather than passing silently.
export function buildOwnershipClause(
  user: SessionUser,
  accessMap: OwnershipMap | undefined,
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle tables carry schema-dependent column shapes
  table: any,
): OwnershipClause {
  if (!accessMap || Object.keys(accessMap).length === 0) return PASS_CLAUSE;

  const clauses: SQL[] = [];
  let anyRoleMatched = false;
  let everyRuleCollapsedToEmpty = true;

  for (const role of user.roles) {
    const rule = accessMap[role];
    if (!rule) continue;
    anyRoleMatched = true;
    // "all" = no filter at all for this role; short-circuit.
    if (rule === "all") return PASS_CLAUSE;
    const resolved = ruleToClause(rule, user, table);
    if (resolved.kind === "sql") {
      clauses.push(resolved.sql);
      everyRuleCollapsedToEmpty = false;
    }
    // "empty" contribution from one role doesn't short-circuit: another
    // role might still contribute an OR-branch. But if ALL branches are
    // empty, the result is empty.
  }

  if (!anyRoleMatched) return EMPTY_CLAUSE;
  if (everyRuleCollapsedToEmpty && clauses.length === 0) return EMPTY_CLAUSE;
  if (clauses.length === 1) {
    const only = clauses[0];
    if (!only) return EMPTY_CLAUSE;
    return { kind: "sql", sql: only };
  }
  // biome-ignore lint/suspicious/noExplicitAny: drizzle or() widened signature
  const combined = or(...(clauses as any)) as SQL;
  return { kind: "sql", sql: combined };
}

type RuleClauseResult = { readonly kind: "empty" } | { readonly kind: "sql"; readonly sql: SQL };

function ruleToClause(
  rule: OwnershipRule,
  user: SessionUser,
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle tables carry schema-dependent column shapes
  table: any,
): RuleClauseResult {
  if (rule === "all") {
    // Caller handles "all" by short-circuit before reaching here; defensive
    // fallback.
    return { kind: "sql", sql: sql`true` };
  }
  if (rule.kind === "where") {
    return { kind: "sql", sql: rule.where(user, table) };
  }
  // FromRule
  const column = table[rule.column];
  // Unknown column — boot validator should have caught this, but at request
  // time we treat as empty (fail-closed).
  if (!column) return { kind: "empty" };

  const value = resolveUserValue(rule, user);
  if (value === undefined || value === null) return { kind: "empty" };

  if (Array.isArray(value)) {
    if (value.length === 0) return { kind: "empty" };
    return { kind: "sql", sql: inArray(column, value) };
  }
  return { kind: "sql", sql: eq(column, value) };
}
