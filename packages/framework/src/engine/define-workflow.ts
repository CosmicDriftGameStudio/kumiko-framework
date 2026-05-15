// defineWorkflow — define a persistent, suspendable workflow.
// Tier-3 / Workflow-only mount-point. See step-vocabulary.md Sample 2 for
// the full lifecycle (run.started → wait → resume → run.completed) and
// Q7 (Snapshot-at-Start) for the in-flight upgrade story.

import { createHash } from "node:crypto";
import type { WriteEvent } from "./types/handlers";
import type { PipelineDef } from "./types/step";

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
export type WorkflowDefinition<TPayload = unknown, TData = unknown> = {
  readonly __kind: "workflow";
  readonly name: string;
  readonly trigger: WorkflowTrigger;
  /** The pipeline definition containing the step list closure. */
  readonly pipelineDef: PipelineDef<TPayload, TData>;
  /** Idempotency key for deduplication — prevents duplicate runs. */
  readonly idempotencyKey?: string | ((event: WriteEvent<TPayload>) => string);
};

/**
 * Input shape for defineWorkflow() — the user-facing API.
 */
export type WorkflowInput<TPayload = unknown, TData = unknown> = {
  readonly name: string;
  readonly trigger: WorkflowTrigger;
  readonly steps: PipelineDef<TPayload, TData>;
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
 *   steps: pipeline(({ event, r }) => [
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
export function defineWorkflow<TPayload = unknown, TData = unknown>(
  input: WorkflowInput<TPayload, TData>,
): WorkflowDefinition<TPayload, TData> {
  return {
    __kind: "workflow",
    name: input.name,
    trigger: input.trigger,
    pipelineDef: input.steps,
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
export function computeDefinitionFingerprint(
  workflow: Pick<WorkflowDefinition, "name" | "trigger" | "pipelineDef">,
): string {
  const material = JSON.stringify({
    name: workflow.name,
    trigger: workflow.trigger,
    source: workflow.pipelineDef.build.toString(),
  });
  return createHash("sha256").update(material).digest("hex");
}
