// step-dispatcher — bundled-feature that drains deferred Tier-2 step
// requests (webhook.send, mail.send, ...) after their TX commits.
//
// Listens on the `kumiko:system:step.dispatch-requested` system event
// (registry-bypassed, see append-event-core.ts SYSTEM_EVENT_PREFIX).
// Performs the side-effect and emits `kumiko:system:step.dispatched`
// or `kumiko:system:step.dispatch-failed` back onto the same stream so
// the audit trail lives in the event log only — no separate status table.

import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { type MailSpec, performMailDispatch } from "./mail-runner";
import { performWebhookDispatch, type WebhookSpec } from "./webhook-runner";

export const STEP_DISPATCH_AGGREGATE_TYPE = "step-dispatch";
export const STEP_DISPATCH_REQUESTED_TYPE = "kumiko:system:step.dispatch-requested";
export const STEP_DISPATCHED_TYPE = "kumiko:system:step.dispatched";
export const STEP_DISPATCH_FAILED_TYPE = "kumiko:system:step.dispatch-failed";

type DispatchRequestedPayload =
  | {
      readonly stepKind: "webhook.send";
      readonly spec: WebhookSpec;
      readonly retry?: { readonly times: number; readonly backoff: "exponential" | "linear" };
    }
  | {
      readonly stepKind: "mail.send";
      readonly spec: MailSpec;
    };

export function createStepDispatcherFeature(): FeatureDefinition {
  return defineFeature("step-dispatcher", (r) => {
    r.systemScope();

    r.multiStreamProjection({
      name: "step-dispatcher",
      apply: {
        [STEP_DISPATCH_REQUESTED_TYPE]: async (event, _tx, ctx) => {
          const payload = event.payload as DispatchRequestedPayload;
          const result =
            payload.stepKind === "webhook.send"
              ? await performWebhookDispatch(payload.spec)
              : await performMailDispatch(payload.spec);
          if (result.ok) {
            await ctx.unsafeAppendEvent({
              aggregateId: event.aggregateId,
              aggregateType: STEP_DISPATCH_AGGREGATE_TYPE,
              type: STEP_DISPATCHED_TYPE,
              payload: { stepKind: payload.stepKind, status: result.status },
            });
          } else {
            await ctx.unsafeAppendEvent({
              aggregateId: event.aggregateId,
              aggregateType: STEP_DISPATCH_AGGREGATE_TYPE,
              type: STEP_DISPATCH_FAILED_TYPE,
              payload: { stepKind: payload.stepKind, error: result.error, attempt: 1 },
            });
          }
        },
      },
    });
  });
}
