// r.step.unsafeProjectionDelete — delete row(s) from a read-side
// projection table.
//
// Sibling to unsafeProjectionUpsert with the same boot-validation
// contract: target table must be in the owning feature's
// r.requires.projection allowlist, must NOT be a registered
// r.entity-aggregate-table. Skips the same set of framework-protections
// (lifecycle hooks, field-access, audit-trail, etc.) — see
// step-vocabulary.md "Was unsafeProjection.* überspringt".
//
// Convention (not enforced): most legitimate read-side deletions are
// downstream of an aggregate event (e.g. delete-user → cascading
// subscription rows vanish). The right home for those is
// `r.multiStreamProjection.apply` keyed on the aggregate event, not
// an inline-step. The inline-step is appropriate when the deletion
// must commit in the same TX as the aggregate-mutation that triggered
// it (stronger consistency than an async projection). Reviewer judges.

import { type WhereObject, deleteMany } from "../../bun-db/query";
import { defineStep } from "../define-step";
import type { PipelineCtx, StepInstance, StepResolver } from "../types/step";
import { resolveRequired } from "./_resolver-utils";

// `where` is REQUIRED — table-wide DELETE without a clause is a TRUNCATE
// in disguise, exactly the footgun the `unsafe`-prefix is meant to
// surface. If a real use-case needs full-table purge, add an explicit
// `r.step.unsafeProjectionTruncate` step rather than loosening this
// type to `SQL | undefined`.
type UnsafeProjectionDeleteArgs = {
  readonly table: unknown;
  readonly where: StepResolver<WhereObject>;
};

defineStep<UnsafeProjectionDeleteArgs, void>({
  kind: "unsafeProjectionDelete",
  defaultFailureStrategy: "throw",
  run: async (args, ctx: PipelineCtx) => {
    const where = resolveRequired(args.where, ctx);
    await deleteMany(ctx.db.raw, args.table, where);
  },
});

export function buildUnsafeProjectionDeleteStep(args: UnsafeProjectionDeleteArgs): StepInstance {
  return { kind: "unsafeProjectionDelete", args };
}
