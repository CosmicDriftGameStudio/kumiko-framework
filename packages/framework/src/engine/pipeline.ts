// pipeline() — public factory used in defineWriteHandler({ perform: pipeline(...) }).
//
// The closure receives { event, r } and returns the immutable list of
// step instances. `r` is the StepBuilder singleton; new tier-1 steps
// add a builder factory in steps/<x>.ts and expose it under `step` below.
//
// `steps` and `scope` are NOT exposed at build time — they only exist on
// the resolver-side PipelineCtx (run-pipeline.ts). Resolvers that need
// prior step results destructure them from the resolver's ctx.
//
// Naming note (Followup #1): the public `pipeline()` helper shares its
// name with the internal `packages/framework/src/pipeline/` directory
// (dispatcher, lifecycle, outbox-poller). No user-visible collision —
// the internal directory isn't an export — but maintainer repo-wide
// grep for `pipeline` returns mixed results. If a rename ever lands,
// candidates are `r.steps([...])` for the public API or
// `engine-pipeline/` / `runtime/` for the internal directory.
// Decision-cost grows with each new caller; the rename window narrows
// after the first external consumer.

import { buildAggregateAppendEventStep } from "./steps/aggregate-append-event";
import { buildAggregateCreateStep } from "./steps/aggregate-create";
import { buildAggregateUpdateStep } from "./steps/aggregate-update";
import { buildBranchStep } from "./steps/branch";
import { buildComputeStep } from "./steps/compute";
import { buildForEachStep } from "./steps/for-each";
import { buildReadFindManyStep } from "./steps/read-find-many";
import { buildReadFindOneStep } from "./steps/read-find-one";
import { buildReturnStep } from "./steps/return";
import { buildUnsafeProjectionDeleteStep } from "./steps/unsafe-projection-delete";
import { buildUnsafeProjectionUpsertStep } from "./steps/unsafe-projection-upsert";
import { buildWebhookSendStep } from "./steps/webhook-send";
import type { WriteEvent } from "./types/handlers";
import type { PipelineBuildCtx, PipelineDef, StepBuilder, StepInstance } from "./types/step";

const stepBuilder: StepBuilder = {
  step: {
    return: buildReturnStep,
    compute: buildComputeStep,
    branch: buildBranchStep,
    forEach: buildForEachStep,
    unsafeProjectionUpsert: buildUnsafeProjectionUpsertStep,
    unsafeProjectionDelete: buildUnsafeProjectionDeleteStep,
    aggregate: {
      create: buildAggregateCreateStep,
      update: buildAggregateUpdateStep,
      appendEvent: buildAggregateAppendEventStep,
    },
    read: {
      findOne: buildReadFindOneStep,
      findMany: buildReadFindManyStep,
    },
    webhook: {
      send: buildWebhookSendStep,
    },
  },
};

export function pipeline<TPayload = unknown, TData = unknown>(
  closure: (ctx: PipelineBuildCtx<TPayload>) => readonly StepInstance[],
): PipelineDef<TPayload, TData> {
  return {
    __kind: "pipeline",
    build: closure,
  };
}

// Internal: invoked by run-pipeline.ts to materialise the step list.
// Not exported from the engine barrel — pipeline-internal plumbing.
export function buildPipelineSteps<TPayload>(
  pipelineDef: PipelineDef<TPayload>,
  event: WriteEvent<TPayload>,
): readonly StepInstance[] {
  return pipelineDef.build({ event, r: stepBuilder });
}
