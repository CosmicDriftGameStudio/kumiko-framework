// r.step.aggregate.create — open a new event-sourced aggregate stream.
//
// Wraps the existing createEventStoreExecutor.create(): writes the
// `<entity>.created` event to the aggregate stream + applies the inline
// projection, both in the active TX. Lifecycle hooks (postSave),
// field-access write rules, crypto-shredding, audit-trail and the rest
// of the framework-protections all run because we go through the
// executor (the canonical aggregate-mutation path).
//
// Returns the SaveContext { id, data, changes, previous, isNew, event }
// — landed under steps.<name> so subsequent steps can read steps.<name>.id.
//
// Failure-handling: M.1.1's "throw"-only strategy applies. If the
// executor returns a WriteFailure, we re-raise as a KumikoError so the
// dispatcher's catch maps it to the standard write-failure shape on the
// HTTP response.

import type { EventStoreExecutor } from "../../db/event-store-executor";
import { reraiseAsKumikoError } from "../../errors/write-error-info";
import { defineStep } from "../define-step";
import type { SaveContext } from "../types/hooks";
import type { PipelineCtx, StepInstance, StepResolver } from "../types/step";
import { resolveRequired } from "./_resolver-utils";

type AggregateCreateArgs = {
  readonly name: string;
  readonly executor: EventStoreExecutor;
  readonly data: StepResolver<Record<string, unknown>>;
};

defineStep<AggregateCreateArgs, SaveContext>({
  kind: "aggregate.create",
  defaultFailureStrategy: "throw",
  resultKey: (args) => args.name,
  run: async (args, ctx: PipelineCtx) => {
    const data = resolveRequired(args.data, ctx);
    const result = await args.executor.create(data, ctx.event.user, ctx.db);
    if (!result.isSuccess) {
      throw reraiseAsKumikoError(result.error);
    }
    return result.data;
  },
});

export function buildAggregateCreateStep(
  name: string,
  opts: {
    readonly executor: EventStoreExecutor;
    readonly data: StepResolver<Record<string, unknown>>;
  },
): StepInstance {
  return {
    kind: "aggregate.create",
    args: { name, executor: opts.executor, data: opts.data } satisfies AggregateCreateArgs,
  };
}
