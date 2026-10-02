// Evaluator for the persisted r.step.waitForEvent `match` AST (EventMatch).
// Runtime-only: kept in the framework package (not packages/types) so it
// stays out of the type graph, same steps/-vs-packages/types split as
// _duration-utils.ts.

import type { EventMatch, EventMatchExpr, EventMatchOp } from "../types/step.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function resolvePath(payload: unknown, path: readonly string[]): unknown {
  let current: unknown = payload;
  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function compareOrdered(
  actual: number | string,
  expected: number | string,
  kind: "gt" | "gte" | "lt" | "lte",
): boolean {
  if (typeof actual === "number" && typeof expected === "number") {
    switch (kind) {
      case "gt":
        return actual > expected;
      case "gte":
        return actual >= expected;
      case "lt":
        return actual < expected;
      case "lte":
        return actual <= expected;
    }
  }
  if (typeof actual === "string" && typeof expected === "string") {
    switch (kind) {
      case "gt":
        return actual > expected;
      case "gte":
        return actual >= expected;
      case "lt":
        return actual < expected;
      case "lte":
        return actual <= expected;
    }
  }
  return false;
}

function evaluateOp(op: EventMatchOp, actual: unknown): boolean {
  switch (op.kind) {
    case "eq":
      return actual === op.value;
    case "ne":
      return actual !== op.value;
    case "in":
      if (!Array.isArray(op.values)) throw malformed(`"in" op has no "values" array`);
      return op.values.some((value) => value === actual);
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      // A payload value of a different primitive kind than the operand
      // doesn't match — bad input, not a malformed AST.
      if (typeof actual !== "number" && typeof actual !== "string") return false;
      return compareOrdered(actual, op.value, op.kind);
    default: {
      // op.kind comes from a persisted event, not from this call's static
      // type — an unrecognized kind means a format we don't understand.
      const unrecognized: { readonly kind: string } = op;
      throw new Error(`Unknown EventMatchOp kind "${unrecognized.kind}"`);
    }
  }
}

// The AST round-trips through jsonb, so a truncated or hand-edited row must
// fail with a readable format error rather than a bare TypeError.
function malformed(what: string): Error {
  return new Error(`Malformed EventMatch: ${what}`);
}

function evaluateExpr(expr: EventMatchExpr, payload: unknown): boolean {
  if (!isRecord(expr)) throw malformed("expr is not an object");
  switch (expr.kind) {
    case "and":
    case "or": {
      if (!Array.isArray(expr.nodes)) throw malformed(`"${expr.kind}" expr has no "nodes" array`);
      return expr.kind === "and"
        ? expr.nodes.every((node) => evaluateExpr(node, payload))
        : expr.nodes.some((node) => evaluateExpr(node, payload));
    }
    case "atom":
      if (!Array.isArray(expr.path)) throw malformed(`"atom" expr has no "path" array`);
      if (!isRecord(expr.op)) throw malformed(`"atom" expr has no "op" object`);
      return evaluateOp(expr.op, resolvePath(payload, expr.path));
    default: {
      const unrecognized: { readonly kind: string } = expr;
      throw new Error(`Unknown EventMatchExpr kind "${unrecognized.kind}"`);
    }
  }
}

export function evaluateEventMatch(match: EventMatch, payload: unknown): boolean {
  if (!isRecord(match)) throw malformed("match is not an object");
  if (match.version !== 1) {
    throw new Error(`Unsupported EventMatch version ${JSON.stringify(match.version)} — expected 1`);
  }
  return evaluateExpr(match.expr, payload);
}
