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
// Renamed from `pipeline()` (Followup #1) — it shared its name with the
// internal `packages/framework/src/pipeline/` directory (dispatcher,
// lifecycle, outbox-poller), which made repo-wide grep for `pipeline`
// return mixed results.

import { buildAggregateAppendEventStep } from "./steps/aggregate-append-event";
import { buildAggregateCreateStep } from "./steps/aggregate-create";
import { buildAggregateUpdateStep } from "./steps/aggregate-update";
import { buildBranchStep } from "./steps/branch";
import { buildCallFeatureStep } from "./steps/call-feature";
import { buildComputeStep } from "./steps/compute";
import { buildForEachStep } from "./steps/for-each";
import { buildMailSendStep } from "./steps/mail-send";
import { buildReadFindManyStep } from "./steps/read-find-many";
import { buildReadFindOneStep } from "./steps/read-find-one";
import { buildRetryStep } from "./steps/retry";
import { buildReturnStep } from "./steps/return";
import { buildUnsafeProjectionDeleteStep } from "./steps/unsafe-projection-delete";
import { buildUnsafeProjectionUpsertStep } from "./steps/unsafe-projection-upsert";
import { buildWaitStep } from "./steps/wait";
import { buildWaitForEventStep } from "./steps/wait-for-event";
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
    mail: {
      send: buildMailSendStep,
    },
    callFeature: buildCallFeatureStep,
    // Tier-3 / Workflow-only steps
    wait: buildWaitStep,
    waitForEvent: buildWaitForEventStep,
    retry: buildRetryStep,
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
// @wrapper-known semantic-alias
export function buildPipelineSteps<TPayload>(
  pipelineDef: PipelineDef<TPayload>,
  event: WriteEvent<TPayload>,
): readonly StepInstance[] {
  return pipelineDef.build({ event, r: stepBuilder });
}
