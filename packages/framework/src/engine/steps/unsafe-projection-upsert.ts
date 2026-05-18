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

import { getTableColumns, type Table } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { defineStep } from "../define-step";
import type { PipelineCtx, StepInstance, StepResolver } from "../types/step";
import { asQueryTarget } from "./_drizzle-boundary";
import { resolveRequired } from "./_resolver-utils";

type UnsafeProjectionUpsertArgs = {
  readonly table: Table;
  readonly on: readonly string[];
  readonly row: StepResolver<Record<string, unknown>>;
};

defineStep<UnsafeProjectionUpsertArgs, void>({
  kind: "unsafeProjectionUpsert",
  defaultFailureStrategy: "throw",
  run: async (args, ctx: PipelineCtx) => {
    const resolvedRow = resolveRequired(args.row, ctx);

    const columns = getTableColumns(args.table) as Record<string, unknown>;
    const conflictTargets = args.on.map((key) => {
      const col = columns[key];
      if (!col) {
        throw new Error(`unsafeProjectionUpsert: column "${key}" not found on target table`);
      }
      return col;
    });

    // SET clause is the same row minus the conflict-key columns —
    // updating a key to itself is harmless but verbose.
    const updateSet: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(resolvedRow)) {
      if (!args.on.includes(k)) updateSet[k] = v;
    }

    // @cast-boundary drizzle-bridge — The values + set + target casts
    // cross the drizzle type-boundary for the same reason as
    // asQueryTarget: resolvedRow is Record<string, unknown> by design
    // (M.1 phantom-typing limit), drizzle's typed-builder expects
    // table-specific shapes. Step-author owns shape correctness.
    // `as never` (not `as any`) — never is contravariantly assignable to
    // every drizzle Insert-shape; explicit "this bypass cannot be made
    // type-safe without lifting <TTable extends Table>" marker.
    await ctx.db
      .insert(asQueryTarget(args.table))
      .values(resolvedRow as never)
      .onConflictDoUpdate({
        target: conflictTargets as unknown as PgColumn[],
        set: updateSet as never,
      });
  },
});

export function buildUnsafeProjectionUpsertStep(args: UnsafeProjectionUpsertArgs): StepInstance {
  return { kind: "unsafeProjectionUpsert", args };
}
