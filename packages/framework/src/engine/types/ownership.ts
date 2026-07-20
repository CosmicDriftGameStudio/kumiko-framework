// --- Ownership ---
// Pure types for the declarative Claims → Access bridge. Runtime (from(),
// matchesRule(), buildOwnershipClause()) stays in engine/ownership.ts, which
// re-exports these for backwards compatibility.

import type { SessionUser } from "./handlers";

// Parameterised SQL fragment — produced by buildOwnershipClause + by the
// WhereRule escape-hatch. Caller weaves `sqlText` into a larger statement,
// renumbering placeholders if needed (shiftParams in engine/ownership.ts).
export type SqlFragment = {
  readonly sqlText: string;
  readonly params: readonly unknown[];
};

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

// Context passed to a WhereRule escape-hatch. The author returns a SqlFragment
// whose placeholders start at `paramStart` ($N, $N+1, ...); the framework
// concatenates the fragment into the larger query.
export type WhereRuleContext<TTable = unknown> = {
  readonly table: TTable;
  readonly tableName: string;
  readonly paramStart: number;
};

export type WhereRule<TTable = unknown> = {
  readonly kind: "where";
  readonly where: (user: SessionUser, ctx: WhereRuleContext<TTable>) => SqlFragment;
};

// "all" collapses to a primitive so map authors can write `Admin: "all"`
// without importing a helper.
export type OwnershipRule = "all" | FromRule | WhereRule;

// Per-role map: every key is a role name, value is the rule that role
// satisfies to pass the access check.
export type OwnershipMap = Readonly<Record<string, OwnershipRule>>;

// Result of buildOwnershipClause. The discriminant lets the caller handle
// the three outcomes without inspecting SQL internals:
//
//   "pass"  → user is unrestricted. Run the query as-is.
//   "empty" → user has a role mapped but no rule accepts any row (missing
//             claim, empty array, role not in map). Skip the DB call entirely
//             — returning [] is equivalent and avoids a pointless roundtrip.
//   "sql"   → apply the parameterised fragment as an AND on the query.
//             Caller is responsible for renumbering placeholders when
//             concatenating with other fragments (see `shiftParams`).
//
// "empty" vs. "pass" is the critical distinction for a safe default:
// undefined/pass = allow, empty = deny-by-construction.
export type OwnershipClause =
  | { readonly kind: "pass" }
  | { readonly kind: "empty" }
  | { readonly kind: "sql"; readonly sqlText: string; readonly params: readonly unknown[] };
