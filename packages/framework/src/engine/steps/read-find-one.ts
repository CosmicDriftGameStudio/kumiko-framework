// r.step.read.findOne — load a single row from a projection table.
//
// Thin wrapper on ctx.db.select().from(table).where(where).limit(1).
// Resolves to the first row or null. Tenant-isolation: the caller's
// `where` clause is responsible for any tenantId filter — read.findOne
// does NOT auto-inject one (different from ctx.queryProjection which
// does). That's deliberate: most read-step uses are aggregate-lookups
// where the where-clause already pins a uuid that's globally unique;
// auto-tenant-filtering would be redundant and would surprise users
// who pass an explicit tenantId.
//
// Use when a subsequent step needs a row from the read-side. For
// cross-feature reads, prefer `r.step.callFeature(...)` (M.2) so the
// other feature's query-handler runs (with its access-rules + audit).
//
// `where` should resolve to a clause that matches at most one row
// (typical: equality on PK / unique-constraint). When multiple rows
// satisfy the clause, the LIMIT 1 picks one in driver-defined order
// (Postgres: insertion order in practice, but not specified) — that's
// fine for "find by uuid", a footgun for "find by tenantId". No
// runtime check; reviewer responsibility.

import type { SQL, Table } from "drizzle-orm";
import { defineStep } from "../define-step";
import type { PipelineCtx, StepInstance, StepResolver } from "../types/step";
import { asQueryTarget } from "./_drizzle-boundary";
import { resolveRequired } from "./_resolver-utils";

type ReadFindOneArgs = {
  readonly name: string;
  readonly table: Table;
  readonly where: StepResolver<SQL | undefined>;
};

defineStep<ReadFindOneArgs, Record<string, unknown> | null>({
  kind: "read.findOne",
  defaultFailureStrategy: "throw",
  resultKey: (args) => args.name,
  run: async (args, ctx: PipelineCtx) => {
    const where = resolveRequired(args.where, ctx);
    const query = ctx.db.select().from(asQueryTarget(args.table));
    const rows = where === undefined ? await query.limit(1) : await query.where(where).limit(1);
    return (rows[0] as Record<string, unknown> | undefined) ?? null;
  },
});

export function buildReadFindOneStep(
  name: string,
  opts: {
    readonly table: Table;
    readonly where: StepResolver<SQL | undefined>;
  },
): StepInstance {
  return {
    kind: "read.findOne",
    args: { name, ...opts } satisfies ReadFindOneArgs,
  };
}
