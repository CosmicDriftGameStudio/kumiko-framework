// r.step.aggregate.update — apply a delta to an existing aggregate stream.
//
// Wraps the existing createEventStoreExecutor.update(): writes the
// `<entity>.updated` event + applies the inline projection in the
// active TX. Optimistic-locking via the optional `version` field —
// pipeline-author can supply the loaded version (often via a prior
// r.step.read.findOne) or skip with skipOptimisticLock.
//
// Returns the SaveContext { id, data, changes, previous, isNew, event }
// — landed under steps.<name>. `changes` and `previous` are useful for
// hooks/audit consumers; the `id` matches the input id.
//
// Failure-handling mirrors aggregate.create: WriteFailure → re-raised
// as KumikoError → dispatcher catches and maps.

import type { EventStoreExecutor } from "../../db/event-store-executor";
import { reraiseAsKumikoError } from "../../errors/write-error-info";
import { defineStep } from "../define-step";
import type { SaveContext } from "../types/hooks";
import type { EntityId } from "../types/identifiers";
import type { PipelineCtx, StepInstance, StepResolver } from "../types/step";

type AggregateUpdateArgs = {
  readonly name: string;
  readonly executor: EventStoreExecutor;
  readonly id: StepResolver<EntityId>;
  readonly changes: StepResolver<Record<string, unknown>>;
  readonly version?: StepResolver<number | undefined>;
  readonly skipOptimisticLock?: boolean;
};

defineStep<AggregateUpdateArgs, SaveContext>({
  kind: "aggregate.update",
  defaultFailureStrategy: "throw",
  resultKey: (args) => args.name,
  run: async (args, ctx: PipelineCtx) => {
    const id = typeof args.id === "function" ? args.id(ctx) : args.id;
    const changes = typeof args.changes === "function" ? args.changes(ctx) : args.changes;
    const version = typeof args.version === "function" ? args.version(ctx) : args.version;
    const result = await args.executor.update(
      { id, version, changes },
      ctx.event.user,
      ctx.db,
      args.skipOptimisticLock ? { skipOptimisticLock: true } : undefined,
    );
    if (!result.isSuccess) {
      throw reraiseAsKumikoError(result.error);
    }
    return result.data;
  },
});

export function buildAggregateUpdateStep(
  name: string,
  opts: {
    readonly executor: EventStoreExecutor;
    readonly id: StepResolver<EntityId>;
    readonly changes: StepResolver<Record<string, unknown>>;
    readonly version?: StepResolver<number | undefined>;
    readonly skipOptimisticLock?: boolean;
  },
): StepInstance {
  return {
    kind: "aggregate.update",
    args: { name, ...opts } satisfies AggregateUpdateArgs,
  };
}
