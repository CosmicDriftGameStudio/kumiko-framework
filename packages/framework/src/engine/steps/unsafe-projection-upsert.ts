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

    // The values + set + target casts cross the drizzle type-boundary
    // for the same reason as asQueryTarget — resolvedRow is
    // Record<string, unknown> by design (M.1 phantom-typing limit),
    // drizzle's typed-builder expects table-specific shapes. Step-author
    // owns shape correctness.
    await ctx.db
      .insert(asQueryTarget(args.table))
      // biome-ignore lint/suspicious/noExplicitAny: drizzle type-boundary
      .values(resolvedRow as any)
      // biome-ignore lint/suspicious/noExplicitAny: drizzle type-boundary
      .onConflictDoUpdate({ target: conflictTargets as any, set: updateSet as any });
  },
});

export function buildUnsafeProjectionUpsertStep(args: UnsafeProjectionUpsertArgs): StepInstance {
  return { kind: "unsafeProjectionUpsert", args };
}
