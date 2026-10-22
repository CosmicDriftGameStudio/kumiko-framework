import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import type {
  JsonTextMatch,
  WhereObject,
  WhereOperator,
} from "@cosmicdrift/kumiko-types/where-clause-types";
import { computeBlindIndex, configuredBlindIndexKey } from "../crypto/blind-index.ts";
import { quoteIdent } from "../crypto/ciphertext-pattern.ts";
import { prepareJsonbValue, prepareValue } from "./driver-value-preparation.ts";
import type { TableInfo } from "./table-info.ts";

type WhereColumn = {
  readonly info: TableInfo;
  readonly column: string;
  readonly pgType: string | undefined;
  readonly ref: (column: string) => string;
  readonly bind: (value: unknown) => string;
};

// undefined = this operator contributes no condition
type OperatorEmitter = (target: WhereColumn, operator: WhereOperator) => string | undefined;

function isJsonTextMatchList(
  value: JsonTextMatch | readonly JsonTextMatch[],
): value is readonly JsonTextMatch[] {
  return Array.isArray(value);
}

function isWhereOperator(v: unknown): v is WhereOperator {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  // Don't false-positive on Date / Temporal / other domain-objects.
  // WhereOperator is plain object literal with at most these keys.
  const keys = Object.keys(v);
  if (keys.length === 0) return false;
  return keys.every((key) => Object.hasOwn(OPERATOR_EMITTERS, key));
}

function isJsonbScalar(value: unknown): boolean {
  return value !== null && typeof value !== "object";
}

function valueList(target: WhereColumn, values: readonly unknown[]): string {
  return values
    .map((v) => {
      const p = prepareValue(v, target.pgType);
      return p.kind === "literal" ? p.literal : `${target.bind(p.bound)}${p.sql}`;
    })
    .join(", ");
}

// multiSelect (and any other jsonb-array-of-scalars column) stores an
// array — a filter value is one option, not the whole array, so eq/ne/in
// must check array containment (`@>`) instead of scalar `=`/`<>`/`IN`
// against the jsonb column, which Postgres rejects outright.
// Mirrors applyMultiSelectFilter in event-store-executor-read-filter.ts — keep in lock-step.
function jsonbContainsAny(target: WhereColumn, candidates: readonly unknown[]): string {
  const { column, ref, bind } = target;
  if (candidates.length === 0) return "FALSE";
  const parts: string[] = [];
  for (const v of candidates) {
    const p = prepareJsonbValue([v]);
    // prepareJsonbValue never returns kind:"literal" (only prepareValue's
    // isSqlExpression branch does) — narrow anyway, PreparedValue is a union.
    if (p && p.kind === "param") {
      parts.push(`${ref(column)} @> ${bind(p.bound)}${p.sql}`);
    }
    // A jsonb column holding the scalar itself is never `@>` an array of it.
    if (isJsonbScalar(v)) {
      parts.push(`${ref(column)} = ${bind(JSON.stringify(v))}::text::jsonb`);
    }
  }
  return parts.length > 0 ? `(${parts.join(" OR ")})` : "FALSE";
}

function isValidJsonTextMatch(match: unknown): match is JsonTextMatch {
  if (match === null || typeof match !== "object") return false;
  const keys = propertyOf(match, "keys");
  return (
    Array.isArray(keys) &&
    keys.length > 0 &&
    keys.every((k) => typeof k === "string") &&
    typeof propertyOf(match, "eq") === "string"
  );
}

function jsonTextMatchCondition(target: WhereColumn, match: unknown): string {
  const { column, ref, bind } = target;
  if (!isValidJsonTextMatch(match)) {
    throw new Error(
      `where: jsonText on column "${column}" needs non-empty string keys and a string eq`,
    );
  }
  const lookups = match.keys.map((key) => `${ref(column)}->>${bind(key)}::text`);
  const lhs = lookups.length === 1 ? lookups[0] : `COALESCE(${lookups.join(", ")})`;
  return `(${lhs} = ${bind(match.eq)})`;
}

function emitJsonText(target: WhereColumn, operator: WhereOperator): string | undefined {
  const { column, pgType } = target;
  const operand = operator.jsonText;
  if (operand === undefined) return undefined;
  if (Object.keys(operator).length > 1) {
    throw new Error(
      `where: jsonText on column "${column}" cannot be combined with other operators`,
    );
  }
  if (pgType !== "jsonb") {
    throw new Error(`where: jsonText requires a jsonb column, "${column}" is ${pgType}`);
  }
  const matches = isJsonTextMatchList(operand) ? operand : [operand];
  if (matches.length === 0) return "FALSE";
  return matches.map((match) => jsonTextMatchCondition(target, match)).join(" AND ");
}

function comparisonCondition(target: WhereColumn, symbol: string, operand: unknown): string {
  const { column, pgType, ref, bind } = target;
  const p = prepareValue(operand, pgType);
  return p.kind === "literal"
    ? `${ref(column)} ${symbol} ${p.literal}`
    : `${ref(column)} ${symbol} ${bind(p.bound)}${p.sql}`;
}

function comparisonEmitter(
  key: "gt" | "gte" | "lt" | "lte" | "like",
  symbol: string,
): OperatorEmitter {
  return (target, operator) => {
    const operand: unknown = operator[key];
    if (operand === undefined) return undefined;
    // Mirrors applyMultiSelectFilter: ordering/pattern ops have no meaning on a jsonb
    // option array (`like` would crash as `jsonb ~~ jsonb`), so match nothing.
    if (target.pgType === "jsonb") return "FALSE";
    return comparisonCondition(target, symbol, operand);
  };
}

// Mirrors applyMultiSelectFilter: an array `ne` means "does not contain all of these".
function jsonbNotEqualCondition(target: WhereColumn, operand: unknown): string | undefined {
  const { column, ref, bind } = target;
  if (Array.isArray(operand)) {
    if (operand.length === 0) return "FALSE";
    const p = prepareJsonbValue(operand);
    if (p && p.kind === "param") {
      return `(${ref(column)} IS NULL OR NOT (${ref(column)} @> ${bind(p.bound)}${p.sql}))`;
    }
  }
  if (isJsonbScalar(operand)) {
    const p = prepareJsonbValue([operand]);
    if (p && p.kind === "param") {
      return `(${ref(column)} IS NULL OR NOT (${ref(column)} @> ${bind(p.bound)}${p.sql} OR ${ref(column)} = ${bind(JSON.stringify(operand))}::text::jsonb))`;
    }
  }
  return undefined;
}

function emitNotEqual(target: WhereColumn, operator: WhereOperator): string | undefined {
  const operand = operator.ne;
  if (operand === undefined) return undefined;
  if (operand === null && Object.keys(operator).length === 1) {
    return `${target.ref(target.column)} IS NOT NULL`;
  }
  if (target.pgType === "jsonb") {
    const jsonbCondition = jsonbNotEqualCondition(target, operand);
    if (jsonbCondition !== undefined) return jsonbCondition;
  }
  return comparisonCondition(target, "<>", operand);
}

function emitIn(target: WhereColumn, operator: WhereOperator): string | undefined {
  const operand = operator.in;
  if (!Array.isArray(operand)) return undefined;
  if (target.pgType === "jsonb") return jsonbContainsAny(target, operand);
  if (operand.length === 0) return "FALSE";
  return `${target.ref(target.column)} IN (${valueList(target, operand)})`;
}

function emitNotIn(target: WhereColumn, operator: WhereOperator): string | undefined {
  const operand = operator.notIn;
  if (!Array.isArray(operand)) return undefined;
  if (target.pgType === "jsonb") {
    throw new Error(`where: notIn is not supported on jsonb column "${target.column}"`);
  }
  if (operand.length === 0) return "TRUE";
  return `${target.ref(target.column)} NOT IN (${valueList(target, operand)})`;
}

// Insertion order is the SQL emission order. jsonText comes first so its "cannot be combined" error wins over any other
// operator's error; the rest keep the historical order gt, gte, lt, lte, ne, like, in, notIn.
const OPERATOR_EMITTERS: Readonly<Record<keyof WhereOperator, OperatorEmitter>> = {
  jsonText: emitJsonText,
  gt: comparisonEmitter("gt", ">"),
  gte: comparisonEmitter("gte", ">="),
  lt: comparisonEmitter("lt", "<"),
  lte: comparisonEmitter("lte", "<="),
  ne: emitNotEqual,
  like: comparisonEmitter("like", "LIKE"),
  in: emitIn,
  notIn: emitNotIn,
};

function operatorConditions(target: WhereColumn, operator: WhereOperator): string[] {
  const conditions: string[] = [];
  for (const emit of Object.values(OPERATOR_EMITTERS)) {
    const condition = emit(target, operator);
    if (condition !== undefined) conditions.push(condition);
  }
  return conditions;
}

// Blind-index OR rewrite: if the column has a bidx
// counterpart (suffix convention `<col>_bidx`, framework-reserved)
// and a key is configured, equality matches both arms —
// plaintext legacy rows via the plaintext arm, encrypted rows
// via the HMAC. The `kumiko-pii:` prefix on ciphertexts makes
// a random match on the plaintext arm practically impossible.
function equalityCondition(target: WhereColumn, value: unknown): string {
  const { info, column, pgType, ref, bind } = target;
  const p = prepareValue(value, pgType);
  if (p.kind === "literal") return `${ref(column)} = ${p.literal}`;
  const bidxKey = configuredBlindIndexKey();
  const bidxCol = `${column}_bidx`;
  if (
    bidxKey !== undefined &&
    typeof value === "string" &&
    !column.endsWith("_bidx") &&
    info.hasColumn(bidxCol)
  ) {
    return `(${ref(column)} = ${bind(p.bound)} OR ${ref(bidxCol)} = ${bind(computeBlindIndex(bidxKey, value))})`;
  }
  return `${ref(column)} = ${bind(p.bound)}${p.sql}`;
}

function arrayCondition(target: WhereColumn, values: readonly unknown[]): string {
  if (values.length === 0) return "FALSE";
  if (target.pgType === "jsonb") return jsonbContainsAny(target, values);
  return `${target.ref(target.column)} IN (${valueList(target, values)})`;
}

function conditionsForValue(target: WhereColumn, value: unknown): string[] {
  if (value === null) return [`${target.ref(target.column)} IS NULL`];
  if (Array.isArray(value)) return [arrayCondition(target, value)];
  if (isWhereOperator(value)) return operatorConditions(target, value);
  if (target.pgType === "jsonb" && isJsonbScalar(value)) {
    return [jsonbContainsAny(target, [value])];
  }
  return [equalityCondition(target, value)];
}

export function buildWhereClause(
  info: TableInfo,
  where: WhereObject,
  startIndex: number,
  qualifier?: string,
): { sqlText: string; values: unknown[] } {
  const values: unknown[] = [];
  // Single place that renders a column reference, so a join qualifier reaches
  // every arm (blind index, jsonb containment, IS NULL, jsonText) alike.
  const ref = (column: string): string =>
    qualifier === undefined ? quoteIdent(column) : `${quoteIdent(qualifier)}.${quoteIdent(column)}`;
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${startIndex + values.length - 1}`;
  };
  const conditions = Object.entries(where).flatMap(([field, value]) => {
    const column = info.columnOf(field);
    return conditionsForValue({ info, column, pgType: info.pgTypeOf(column), ref, bind }, value);
  });
  return { sqlText: conditions.join(" AND "), values };
}
