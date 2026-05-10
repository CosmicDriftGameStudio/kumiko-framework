// r.step.read.findMany — load multiple rows from a projection table.
//
// Sibling to read.findOne — same tenant-filter caveat (caller-owned),
// same drizzle-boundary cast. Resolves to a row-array (possibly empty),
// landed under steps.<name>.
//
// Optional `limit` for guard-rails — defaults to no-limit so the caller
// chooses. Most legitimate uses iterate via r.step.forEach (M.1.6) over
// the result, where unbounded arrays would be the bug.

import type { SQL, Table } from "drizzle-orm";
import { defineStep } from "../define-step";
import type { PipelineCtx, StepInstance, StepResolver } from "../types/step";

type ReadFindManyArgs = {
  readonly name: string;
  readonly table: Table;
  readonly where?: StepResolver<SQL | undefined>;
  readonly limit?: number;
};

defineStep<ReadFindManyArgs, readonly Record<string, unknown>[]>({
  kind: "read.findMany",
  defaultFailureStrategy: "throw",
  resultKey: (args) => args.name,
  run: async (args, ctx: PipelineCtx) => {
    const where =
      args.where === undefined
        ? undefined
        : typeof args.where === "function"
          ? args.where(ctx)
          : args.where;
    // biome-ignore lint/suspicious/noExplicitAny: drizzle type-boundary
    const baseQuery = ctx.db.select().from(args.table as any);
    const filteredQuery = where === undefined ? baseQuery : baseQuery.where(where);
    const finalQuery = args.limit === undefined ? filteredQuery : filteredQuery.limit(args.limit);
    const rows = await finalQuery;
    return rows as readonly Record<string, unknown>[];
  },
});

export function buildReadFindManyStep(
  name: string,
  opts: {
    readonly table: Table;
    readonly where?: StepResolver<SQL | undefined>;
    readonly limit?: number;
  },
): StepInstance {
  return {
    kind: "read.findMany",
    args: { name, ...opts } satisfies ReadFindManyArgs,
  };
}
