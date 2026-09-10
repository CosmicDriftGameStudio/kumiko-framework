// Static lint for `WhereRule` SQL fragments (fw#2639).
//
// A `where`-rule hands the framework raw SQL. If the author writes an
// unqualified column name inside a correlated subquery, Postgres binds it
// to the innermost table instead of the outer one — the intended predicate
// silently collapses into a tautology (`t.x = t.x`) and the rule grants
// every row instead of none. This module is a text-level lint (no SQL
// parser) that catches the two shapes that always mean "this rule is
// broken": a bare column reference inside a subquery that shadows an outer
// column, and a literal self-comparison.

import { KUMIKO_COLUMNS_SYMBOL } from "@cosmicdrift/kumiko-types/schema-table-types";
import { toSnakeCase } from "../db/table-builder";

const IDENT_SRC = `"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*`;
const QUALIFIED_SRC = `(?:${IDENT_SRC})(?:\\.(?:${IDENT_SRC}))?`;

const TOKEN_RE = new RegExp(IDENT_SRC, "g");
const SELF_COMPARISON_RE = new RegExp(
  `(${QUALIFIED_SRC})\\s*(?<![!<>=])=(?!=)\\s*(${QUALIFIED_SRC})`,
  "g",
);
const QUALIFIED_PARSE_RE = new RegExp(`^(${IDENT_SRC})(?:\\.(${IDENT_SRC}))?$`);

// Resolve the SQL column names a table exposes, so the lint can tell a
// real column reference apart from a table alias / function name / SQL
// keyword. Returns an empty set when nothing is derivable (fail-open on
// the lint itself would be worse than skipping it).
export function tableColumnSqlNames(table: unknown): ReadonlySet<string> {
  if (table === null || typeof table !== "object") return new Set();

  const cols = (table as Record<symbol, unknown>)[KUMIKO_COLUMNS_SYMBOL];
  if (cols && typeof cols === "object") {
    const names = new Set<string>();
    for (const col of Object.values(cols as Record<string, unknown>)) {
      if (col && typeof col === "object") {
        const nameVal = (col as Record<string, unknown>)["name"];
        if (typeof nameVal === "string") names.add(nameVal.toLowerCase());
      }
    }
    return names;
  }

  // Plain-object fallback (tests): no Drizzle column-symbol map, so every
  // object-valued key is treated as a field and mapped to its SQL name the
  // same way columnSqlName() in ownership.ts does for hand-rolled tables.
  const names = new Set<string>();
  for (const [key, value] of Object.entries(table as Record<string, unknown>)) {
    if (value && typeof value === "object") {
      names.add(toSnakeCase(key).toLowerCase());
    }
  }
  return names;
}

function skipLineComment(sql: string, i: number): number {
  let j = i;
  while (j < sql.length && sql[j] !== "\n") j++;
  return j;
}

function skipBlockComment(sql: string, i: number): number {
  let j = i + 2;
  while (j < sql.length && !(sql[j] === "*" && sql[j + 1] === "/")) j++;
  return j + 2;
}

function skipQuotedLiteral(sql: string, i: number): number {
  let j = i + 1;
  while (j < sql.length) {
    if (sql[j] === "'" && sql[j + 1] === "'") {
      j += 2;
      continue;
    }
    if (sql[j] === "'") {
      j++;
      break;
    }
    j++;
  }
  return j;
}

function stripCommentsAndStrings(sqlText: string): string {
  let result = "";
  let i = 0;
  const len = sqlText.length;
  while (i < len) {
    const ch = sqlText[i];
    if (ch === "-" && sqlText[i + 1] === "-") {
      i = skipLineComment(sqlText, i);
      result += " ";
      continue;
    }
    if (ch === "/" && sqlText[i + 1] === "*") {
      i = skipBlockComment(sqlText, i);
      result += " ";
      continue;
    }
    if (ch === "'") {
      i = skipQuotedLiteral(sqlText, i);
      result += " ";
      continue;
    }
    result += ch;
    i++;
  }
  return result;
}

function normalizeIdent(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/""/g, '"').toLowerCase();
  }
  return raw.toLowerCase();
}

function normalizeQualifiedRef(raw: string): string {
  const parsed = QUALIFIED_PARSE_RE.exec(raw);
  if (!parsed) return normalizeIdent(raw);
  const first = normalizeIdent(parsed[1] ?? "");
  const second = parsed[2];
  return second === undefined ? first : `${first}.${normalizeIdent(second)}`;
}

// Rule 1: `X = Y` where X and Y are textually the same (optionally
// once-qualified) identifier is always a tautology, subquery or not.
function findSelfComparison(cleaned: string): string | null {
  SELF_COMPARISON_RE.lastIndex = 0;
  let match: RegExpExecArray | null = SELF_COMPARISON_RE.exec(cleaned);
  while (match !== null) {
    const left = match[1] ?? "";
    const right = match[2] ?? "";
    if (normalizeQualifiedRef(left) === normalizeQualifiedRef(right)) {
      return left.trim();
    }
    match = SELF_COMPARISON_RE.exec(cleaned);
  }
  return null;
}

// Rule 2: inside a subquery, a bare identifier that happens to name a
// column on the OUTER table is the fail-open shape — Postgres resolves it
// against the innermost table first. A qualifier (`t.x`) or a table/alias
// name immediately followed by `.` is not a column reference and is
// ignored.
function findUnqualifiedColumnReference(
  cleaned: string,
  columnSqlNames: ReadonlySet<string>,
): string | null {
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null = TOKEN_RE.exec(cleaned);
  while (match !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const precededByDot = start > 0 && cleaned[start - 1] === ".";
    const followedByDot = cleaned[end] === ".";
    if (!precededByDot && !followedByDot) {
      const normalized = normalizeIdent(match[0]);
      if (columnSqlNames.has(normalized)) return normalized;
    }
    match = TOKEN_RE.exec(cleaned);
  }
  return null;
}

// Throws (fail-closed) instead of shipping a where-rule that would silently
// fail-open at request time. Called both as a runtime backstop
// (ownership.ts#ruleToFragment) and as a boot-time probe
// (boot-validator/ownership.ts).
export function assertQualifiedWhereFragment(
  sqlText: string,
  columnSqlNames: ReadonlySet<string>,
  scope: string,
): void {
  const cleaned = stripCommentsAndStrings(sqlText);

  const selfComparison = findSelfComparison(cleaned);
  if (selfComparison !== null) {
    throw new Error(
      `[Kumiko Ownership] ${scope}: where-rule SQL compares "${selfComparison}" with itself — this is a tautology that matches every row. Remove the redundant comparison or compare against a real bound value / a different, properly qualified column.`,
    );
  }

  // skip: without a subquery there is no inner table to shadow — a bare
  // column reference cannot bind against anything but the outer table, so
  // the fail-open shape this lint targets is impossible here.
  if (!/\bSELECT\b/i.test(cleaned)) return;

  const unqualified = findUnqualifiedColumnReference(cleaned, columnSqlNames);
  if (unqualified !== null) {
    throw new Error(
      `[Kumiko Ownership] ${scope}: where-rule SQL references column "${unqualified}" unqualified inside a subquery. Postgres binds an unqualified name to the innermost table first, which silently turns the ownership predicate into a tautology (fail-open). Qualify it with the outer table, e.g. \`\${ctx.tableName}.${unqualified}\`.`,
    );
  }
}
