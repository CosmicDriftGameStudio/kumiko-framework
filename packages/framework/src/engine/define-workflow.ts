// defineWorkflow — define a persistent, suspendable workflow.
// Tier-3 / Workflow-only mount-point. See step-vocabulary.md Sample 2 for
// the full lifecycle (run.started → wait → resume → run.completed) and
// Q7 (Snapshot-at-Start) for the in-flight upgrade story.

import { createHash } from "node:crypto";
import type { WriteEvent } from "./types/handlers";
import type { AwaitedEventType, PipelineDef } from "./types/step";

/**
 * Trigger configuration for a workflow. Determines what starts a run.
 */
export type WorkflowTrigger =
  | {
      readonly kind: "event";
      readonly eventType: string;
      readonly filter?: (event: WriteEvent) => boolean;
    }
  | {
      readonly kind: "cron";
      readonly schedule: string; // cron expression
    }
  | {
      readonly kind: "webhook";
      readonly path: string;
    };

/**
 * Workflow definition — the result of defineWorkflow().
 */
export type WorkflowDefinition<
  TPayload = unknown,
  TData = unknown,
  TAwaits extends Record<string, string> = Record<string, string>,
> = {
  readonly __kind: "workflow";
  readonly name: string;
  readonly trigger: WorkflowTrigger;
  /**
   * Declared expected events (D4, workflow-resume-loop.md) — the sole route
   * a waitForEvent step can reach an event type. Read at registration time
   * to build the static apply-map (Phase 3b); values are plain event-type
   * strings, not the branded AwaitedEventType the pipeline closure sees.
   */
  readonly awaits?: TAwaits;
  /** The pipeline definition containing the step list closure. */
  readonly pipelineDef: PipelineDef<
    TPayload,
    TData,
    { readonly [K in keyof TAwaits]: AwaitedEventType }
  >;
  /** Idempotency key for deduplication — prevents duplicate runs. */
  readonly idempotencyKey?: string | ((event: WriteEvent<TPayload>) => string);
};

/**
 * Input shape for defineWorkflow() — the user-facing API.
 */
export type WorkflowInput<
  TPayload = unknown,
  TData = unknown,
  TAwaits extends Record<string, string> = Record<string, string>,
> = {
  readonly name: string;
  readonly trigger: WorkflowTrigger;
  readonly awaits?: TAwaits;
  readonly steps: PipelineDef<TPayload, TData, { readonly [K in keyof TAwaits]: AwaitedEventType }>;
  readonly idempotencyKey?: string | ((event: WriteEvent<TPayload>) => string);
  readonly onError?: PipelineDef<unknown>;
};

/**
 * Define a suspendable workflow.
 *
 * Example:
 * ```ts
 * defineWorkflow({
 *   name: "user-onboarding",
 *   trigger: { kind: "event", eventType: "user.signed-up" },
 *   steps: stepsPipeline(({ event, r }) => [
 *     r.step.mail.send({ to: () => event.payload.email, subject: "Welcome!", body: "..." }),
 *     r.step.wait({ for: "P1D" }),
 *     r.step.read.findOne("user", { table: userTable, where: ... }),
 *     r.step.branch({ if: ({ steps }) => ..., onTrue: [...], onFalse: [...] }),
 *     r.step.retry({ times: 3, backoff: "exponential", do: [
 *       r.step.webhook.send({ url: "...", mode: "deferred" }),
 *     ]}),
 *   ]),
 * });
 * ```
 */
export function defineWorkflow<
  TPayload = unknown,
  TData = unknown,
  const TAwaits extends Record<string, string> = Record<string, string>,
>(input: WorkflowInput<TPayload, TData, TAwaits>): WorkflowDefinition<TPayload, TData, TAwaits> {
  // pipelineDef.awaits carries the same raw strings as the declaration
  // below — buildPipelineSteps (pipeline.ts) is where they're branded into
  // AwaitedEventType for the step closure, not here (see PipelineDef.awaits
  // doc comment in types/step.ts for why the brand can't happen at this
  // layer without breaking inference for an inline `stepsPipeline(...)`).
  return {
    __kind: "workflow",
    name: input.name,
    trigger: input.trigger,
    awaits: input.awaits,
    pipelineDef: { ...input.steps, awaits: input.awaits },
    idempotencyKey: input.idempotencyKey,
  };
}

/**
 * Q7 Snapshot-at-Start fingerprint. SHA-256 over the workflow's stable
 * identity (name + trigger + serialized pipeline-closure source). Persisted
 * in `workflow.run.started` and re-checked at every resume so a library-
 * upgrade that changes the closure source surfaces as a loud
 * `workflow-definition-changed` failure on in-flight runs instead of a
 * silent semantic drift.
 *
 * Limitations (will be tightened in M.5 with the Designer/AST layer):
 *   - `build.toString()` captures the closure source but not bindings —
 *     two definitions that import different external helpers with the
 *     same source bytes would collide. Acceptable for M.4 because the
 *     fingerprint is a *change-detector*, not a deep semantic identity.
 *   - Minifiers / source-maps will produce different fingerprints across
 *     environments. Run-the-fingerprint-in-the-same-environment is the
 *     contract; cross-env replay is out of scope.
 */
export function computeDefinitionFingerprint<
  TPayload = unknown,
  TData = unknown,
  TAwaits extends Record<string, string> = Record<string, string>,
>(
  workflow: Pick<WorkflowDefinition<TPayload, TData, TAwaits>, "name" | "trigger" | "pipelineDef">,
): string {
  // `awaits` is part of the routing contract (D4, workflow-resume-loop.md):
  // changing which events a run waits on changes the run's behavior just
  // like changing the step source does, so a changed declaration must flip
  // the fingerprint and trip the Q7 stale-definition check on resume.
  const material = JSON.stringify({
    name: workflow.name,
    trigger: workflow.trigger,
    awaits: workflow.pipelineDef.awaits,
    source: workflow.pipelineDef.build.toString(),
  });
  return createHash("sha256").update(material).digest("hex");
}
