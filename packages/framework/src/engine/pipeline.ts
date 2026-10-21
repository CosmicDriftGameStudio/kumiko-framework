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

import { buildAggregateAppendEventStep } from "./steps/aggregate-append-event.ts";
import { buildAggregateCreateStep } from "./steps/aggregate-create.ts";
import { buildAggregateUpdateStep } from "./steps/aggregate-update.ts";
import { buildBranchStep } from "./steps/branch.ts";
import { buildCallFeatureStep } from "./steps/call-feature.ts";
import { buildComputeStep } from "./steps/compute.ts";
import { buildForEachStep } from "./steps/for-each.ts";
import { buildMailSendStep } from "./steps/mail-send.ts";
import { buildReadFindManyStep } from "./steps/read-find-many.ts";
import { buildReadFindOneStep } from "./steps/read-find-one.ts";
import { buildRetryStep } from "./steps/retry.ts";
import { buildReturnStep } from "./steps/return.ts";
import { buildUnsafeProjectionDeleteStep } from "./steps/unsafe-projection-delete.ts";
import { buildUnsafeProjectionUpsertStep } from "./steps/unsafe-projection-upsert.ts";
import { buildWaitStep } from "./steps/wait.ts";
import { buildWaitForEventStep } from "./steps/wait-for-event.ts";
import { buildWebhookSendStep } from "./steps/webhook-send.ts";
import type { WriteEvent } from "./types/handlers.ts";
import type {
  AwaitedEventType,
  PipelineBuildCtx,
  PipelineDef,
  StepBuilder,
  StepInstance,
} from "./types/step.ts";

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

export function stepsPipeline<
  TPayload = unknown,
  TData = unknown,
  TAwaits extends Record<string, AwaitedEventType> = Record<string, AwaitedEventType>,
>(
  closure: (ctx: PipelineBuildCtx<TPayload, TAwaits>) => readonly StepInstance[],
): PipelineDef<TPayload, TData, TAwaits> {
  return {
    __kind: "pipeline",
    build: closure,
  };
}

// Internal: invoked by run-pipeline.ts to materialise the step list.
// Not exported from the engine barrel — pipeline-internal plumbing.
// @wrapper-known semantic-alias
//
// `awaits` comes off pipelineDef itself (set by defineWorkflow), not a
// function argument — every existing buildPipelineSteps caller (runner.ts,
// resume-run.write.ts, run-pipeline.ts, validate-projection-allowlist.ts)
// keeps working unchanged while workflow pipelines still get their real
// awaits map wired into the closure. The cast below is the one place a
// workflow's raw declared event-type strings become AwaitedEventType — safe
// because pipelineDef.awaits only ever holds what defineWorkflow's `awaits`
// carried in (D4, workflow-resume-loop.md), never an unchecked external
// value.
export function buildPipelineSteps<TPayload>(
  pipelineDef: PipelineDef<TPayload, unknown, Record<string, AwaitedEventType>>,
  event: WriteEvent<TPayload>,
): readonly StepInstance[] {
  const steps = pipelineDef.build({
    event,
    r: stepBuilder,
    awaits: Object.fromEntries(
      Object.entries(pipelineDef.awaits ?? {}).map(([key, raw]) => [key, raw as AwaitedEventType]),
    ),
  });
  assertUniqueWaitForEventTypes(steps);
  return steps;
}

// waitForEvent's result key is the awaited event type, so a second wait on the
// same type would overwrite the first one's resumed payload.
function assertUniqueWaitForEventTypes(steps: readonly StepInstance[]): void {
  const seen = new Set<unknown>();
  for (const step of steps) {
    if (step.kind !== "workflow.waitForEvent") continue;
    const { event } = step.args as { readonly event: unknown }; // @cast-boundary engine-payload
    if (seen.has(event)) {
      throw new Error(
        `r.step.waitForEvent: event "${String(event)}" is awaited more than once in one workflow — ` +
          "each awaits entry can back only one waitForEvent step.",
      );
    }
    seen.add(event);
  }
}
