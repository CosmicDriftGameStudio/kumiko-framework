// r.step.unsafeProjectionUpsert — inline read-side-projection write.
//
// Idempotent on the supplied conflict-key columns (typically the
// natural key + tenantId). Skips lifecycle hooks, field-access,
// crypto-shredding, schema-versioning, audit-trail, read-access-log.
// See "Was unsafeProjection.* überspringt" in
// docs/plans/architecture/intern/step-vocabulary.md.
//
// Use only on tables explicitly declared via r.requires.projection in
// the owning feature. Aggregate-tables (registered via r.entity) are
// rejected by boot-validation — domain mutation MUST go through
// r.step.aggregate.*.

import { asRawClient } from "../../bun-db/query";
import { defineStep } from "../define-step";
import type { PipelineCtx, StepInstance, StepResolver } from "../types/step";
import { resolveRequired } from "./_resolver-utils";

type UnsafeProjectionUpsertArgs = {
  readonly table: unknown;
  readonly on: readonly string[];
  readonly row: StepResolver<Record<string, unknown>>;
};

// @cast-boundary drizzle-bridge — reads table name + column snake_case
// names from drizzle Symbol-based metadata without importing drizzle-orm.
const DRIZZLE_NAME_SYMBOL = Symbol.for("drizzle:Name");
const DRIZZLE_COLUMNS_SYMBOL = Symbol.for("drizzle:Columns");

function resolveTableName(table: unknown): string {
  if (typeof table !== "object" || table === null) {
    throw new Error("unsafeProjectionUpsert: table is not an object");
  }
  const name = (table as Record<symbol, unknown>)[DRIZZLE_NAME_SYMBOL];
  if (typeof name !== "string") {
    throw new Error("unsafeProjectionUpsert: table has no drizzle:Name symbol");
  }
  return name;
}

function resolveColumnName(table: unknown, field: string): string {
  if (typeof table !== "object" || table === null) return field;
  const cols = (table as Record<symbol, unknown>)[DRIZZLE_COLUMNS_SYMBOL];
  if (typeof cols !== "object" || cols === null) return field;
  const col = (cols as Record<string, unknown>)[field];
  if (typeof col === "object" && col !== null) {
    const nameVal = (col as Record<string, unknown>)["name"];
    if (typeof nameVal === "string") return nameVal;
  }
  return field;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

defineStep<UnsafeProjectionUpsertArgs, void>({
  kind: "unsafeProjectionUpsert",
  defaultFailureStrategy: "throw",
  run: async (args, ctx: PipelineCtx) => {
    const resolvedRow = resolveRequired(args.row, ctx);

    // Validate conflict-key columns exist in the row.
    for (const key of args.on) {
      if (!(key in resolvedRow)) {
        throw new Error(`unsafeProjectionUpsert: column "${key}" not found in row`);
      }
    }

    const tableName = resolveTableName(args.table);
    const entries = Object.entries(resolvedRow);
    const params: unknown[] = [];

    const colNames = entries.map(([k]) => quoteIdent(resolveColumnName(args.table, k)));
    const placeholders = entries.map((_, i) => `$${i + 1}`);
    for (const [, v] of entries) params.push(v);

    const conflictCols = args.on
      .map((k) => quoteIdent(resolveColumnName(args.table, k)))
      .join(", ");

    // SET clause excludes conflict-key columns.
    const setClauses: string[] = [];
    let paramIdx = entries.length + 1;
    for (const [k, v] of entries) {
      if (args.on.includes(k)) continue;
      setClauses.push(`${quoteIdent(resolveColumnName(args.table, k))} = $${paramIdx++}`);
      params.push(v);
    }

    const sqlText =
      `INSERT INTO ${quoteIdent(tableName)} (${colNames.join(", ")}) VALUES (${placeholders.join(", ")}) ` +
      `ON CONFLICT (${conflictCols}) DO UPDATE SET ${setClauses.join(", ")}`;

    await asRawClient(ctx.db.raw).unsafe(sqlText, params);
  },
});

export function buildUnsafeProjectionUpsertStep(args: UnsafeProjectionUpsertArgs): StepInstance {
  return { kind: "unsafeProjectionUpsert", args };
}
