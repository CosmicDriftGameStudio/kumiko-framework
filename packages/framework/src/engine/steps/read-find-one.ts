// r.step.read.findOne — load a single row from a projection table.
//
// Thin wrapper on selectMany(db, table, where, { limit: 1 }) (bun-db).
// Resolves to the first row or null. Tenant-filtered like ctx.db
// method-form reads (own tenant + SYSTEM_TENANT_ID reference rows); a
// foreign `where.tenantId` is narrowed to the caller's own scope.
// Cross-tenant reads require `unsafeAllTenants: { reason }` here AND
// `escapeHatch: { reason }` on the handler — reported as an "unsafe-raw"
// escape-hatch audit event.
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

import { selectMany, type WhereObject } from "../../db/query";
import { defineStep } from "../define-step";
import type { PipelineCtx, StepInstance, StepResolver } from "../types/step";
import { readSourceFor } from "./_read-source";
import { resolveRequired } from "./_resolver-utils";

type ReadFindOneArgs = {
  readonly name: string;
  readonly table: unknown;
  readonly where: StepResolver<WhereObject | undefined>;
  readonly unsafeAllTenants?: { readonly reason: string };
};

defineStep<ReadFindOneArgs, Record<string, unknown> | null>({
  kind: "read.findOne",
  defaultFailureStrategy: "throw",
  resultKey: (args) => args.name,
  run: async (args, ctx: PipelineCtx) => {
    const where = resolveRequired(args.where, ctx);
    const source = readSourceFor(ctx, args.unsafeAllTenants);
    const rows = await selectMany(source, args.table, where, { limit: 1 });
    return (rows[0] as Record<string, unknown> | undefined) ?? null;
  },
});

export function buildReadFindOneStep(
  name: string,
  opts: {
    readonly table: unknown;
    readonly where: StepResolver<WhereObject | undefined>;
    readonly unsafeAllTenants?: { readonly reason: string };
  },
): StepInstance {
  return {
    kind: "read.findOne",
    args: { name, ...opts } satisfies ReadFindOneArgs,
  };
}
