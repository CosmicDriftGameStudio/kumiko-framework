// stepsPipeline() — public factory used in defineWriteHandler({ perform: stepsPipeline(...) }).
//
// The closure receives { event, r } and returns the immutable list of
// step instances. `r` is the StepBuilder singleton; new tier-1 steps
// add a builder factory in steps/<x>.ts and expose it under `step` below.
//
// `steps` and `scope` are NOT exposed at build time — they only exist on
// the resolver-side PipelineCtx (run-pipeline.ts). Resolvers that need
// prior step results destructure them from the resolver's ctx.
//
// Renamed from `pipeline()` — it shared its name with the
// internal `packages/framework/src/pipeline/` directory (dispatcher,
// lifecycle, outbox-poller), which made repo-wide grep for `pipeline`
// return mixed results.

import { buildAggregateAppendEventStep } from "./steps/aggregate-append-event.ts";
import { buildAggregateCreateStep } from "./steps/aggregate-create.ts";
import { buildAggregateUpdateStep } from "./steps/aggregate-update.ts";
import { buildBranchStep } from "./steps/branch.ts";
import { buildCallFeatureStep } from "./steps/call-feature.ts";
import { buildComputeStep } from "./steps/compute.ts";
import { buildForEachStep } from "./steps/for-each.ts";
import { buildReadFindManyStep } from "./steps/read-find-many.ts";
import { buildReadFindOneStep } from "./steps/read-find-one.ts";
import { buildReturnStep } from "./steps/return.ts";
import { buildUnsafeProjectionDeleteStep } from "./steps/unsafe-projection-delete.ts";
import { buildUnsafeProjectionUpsertStep } from "./steps/unsafe-projection-upsert.ts";
import type { WriteEvent } from "./types/handlers.ts";
import type { PipelineBuildCtx, PipelineDef, StepBuilder, StepInstance } from "./types/step.ts";

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
    callFeature: buildCallFeatureStep,
  },
};

export function stepsPipeline<TPayload = unknown, TData = unknown>(
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
  pipelineDef: PipelineDef<TPayload, unknown>,
  event: WriteEvent<TPayload>,
): readonly StepInstance[] {
  return pipelineDef.build({ event, r: stepBuilder });
}
