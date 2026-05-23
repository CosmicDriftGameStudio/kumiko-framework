// r.step.read.findMany — load multiple rows from a projection table.
//
// Sibling to read.findOne — same tenant-filter caveat (caller-owned).
// Resolves to a row-array (possibly empty), landed under steps.<name>.
//
// Optional `limit` — defaults to no-limit (caller-chosen, NOT a
// guard-rail). Most legitimate uses iterate via r.step.forEach (M.1.6)
// over the result, where unbounded arrays would be the bug. Set
// `limit` explicitly when the row-count could grow without bound.

import { type WhereObject, selectMany } from "../../bun-db/query";
import { defineStep } from "../define-step";
import type { PipelineCtx, StepInstance, StepResolver } from "../types/step";
import { resolveOptional } from "./_resolver-utils";

type ReadFindManyArgs = {
  readonly name: string;
  readonly table: unknown;
  readonly where?: StepResolver<WhereObject | undefined>;
  readonly limit?: number;
};

defineStep<ReadFindManyArgs, readonly Record<string, unknown>[]>({
  kind: "read.findMany",
  defaultFailureStrategy: "throw",
  resultKey: (args) => args.name,
  run: async (args, ctx: PipelineCtx) => {
    const where = resolveOptional(args.where, ctx);
    const rows = await selectMany(
      ctx.db.raw,
      args.table,
      where,
      args.limit !== undefined ? { limit: args.limit } : undefined,
    );
    return rows as readonly Record<string, unknown>[];
  },
});

export function buildReadFindManyStep(
  name: string,
  opts: {
    readonly table: unknown;
    readonly where?: StepResolver<WhereObject | undefined>;
    readonly limit?: number;
  },
): StepInstance {
  return {
    kind: "read.findMany",
    args: { name, ...opts } satisfies ReadFindManyArgs,
  };
}
