// step-dispatcher — bundled-feature that drains deferred Tier-2 step
// requests (webhook.send, mail.send, ...) after their TX commits.
//
// Listens on the `kumiko:system:step.dispatch-requested` system event
// (registry-bypassed, see append-event-core.ts SYSTEM_EVENT_PREFIX).
// Performs the side-effect and emits `kumiko:system:step.dispatched`
// or `kumiko:system:step.dispatch-failed` back onto the same stream so
// the audit trail lives in the event log only — no separate status table.

import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { SYSTEM_USER_ID } from "@cosmicdrift/kumiko-types/identifiers";
import * as z from "zod";
import { mailSpecSchema, performMailDispatch } from "./mail-runner";
import {
  performWebhookDispatch,
  WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR,
  webhookSpecSchema,
} from "./webhook-runner";

export const stepDispatcherEnvSchema = z.object({
  [WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR]: z
    .string()
    .optional()
    .describe(
      "Comma-separated operator allowlist of private/internal hosts (e.g. a local webhook-receiver for dev/test) that bypass the public-address check for webhook.send targets. Never a tenant-config value.",
    ),
});

export const STEP_DISPATCH_AGGREGATE_TYPE = "step-dispatch";
export const STEP_DISPATCH_REQUESTED_TYPE = "kumiko:system:step.dispatch-requested";
export const STEP_DISPATCHED_TYPE = "kumiko:system:step.dispatched";
export const STEP_DISPATCH_FAILED_TYPE = "kumiko:system:step.dispatch-failed";

// Runtime-validated instead of cast — `event.payload` is `unknown` at the
// MSP-apply boundary (unsafeAppendEvent), so a payload in an older or
// foreign shape must end as dispatch-failed, never reach performWebhookDispatch.
const dispatchRequestedPayloadSchema = z.discriminatedUnion("stepKind", [
  z.object({
    stepKind: z.literal("webhook.send"),
    spec: webhookSpecSchema,
    retry: z.object({ times: z.number(), backoff: z.enum(["exponential", "linear"]) }).optional(),
  }),
  z.object({ stepKind: z.literal("mail.send"), spec: mailSpecSchema }),
]);

// zod issue messages can echo the invalid value (e.g. a rejected url) back
// into the tenant-visible dispatch-failed event — keep this generic.
const INVALID_DISPATCH_PAYLOAD_ERROR = "invalid dispatch payload";

const rawStepKindSchema = z.object({ stepKind: z.string() });

function rawStepKindOf(payload: unknown): string {
  const parsed = rawStepKindSchema.safeParse(payload);
  return parsed.success ? parsed.data.stepKind : "unknown";
}

export function createStepDispatcherFeature(): FeatureDefinition {
  return defineFeature("step-dispatcher", (r) => {
    r.describe(
      "Internal system feature that drains deferred Tier-2 side-effects (currently `webhook.send` and `mail.send`) after their originating transaction commits. Listens via `r.multiStreamProjection` on the `kumiko:system:step.dispatch-requested` system event, performs the actual HTTP or mail delivery, then appends `kumiko:system:step.dispatched` or `kumiko:system:step.dispatch-failed` back onto the same stream so the outcome is recorded in the event log without a separate status table. Mount this feature explicitly via `createStepDispatcherFeature()` in your app's feature list alongside any features that use `r.step.webhook.send` or `r.step.mail.send`. Requires the `secrets` feature (`createSecretsFeature()`) to be mounted — `webhook.send` auth resolves per-tenant through it, under `step-dispatcher:webhook-auth.<name>`.",
    );
    r.uiHints({
      displayLabel: "Step Dispatcher · Deferred Side-Effects",
      category: "infrastructure",
      recommended: false,
    });
    r.envSchema(stepDispatcherEnvSchema);
    r.requires("secrets");

    r.multiStreamProjection({
      name: "step-dispatcher",
      apply: {
        [STEP_DISPATCH_REQUESTED_TYPE]: async (event, _tx, ctx) => {
          const parsed = dispatchRequestedPayloadSchema.safeParse(event.payload);
          if (!parsed.success) {
            await ctx.unsafeAppendEvent({
              aggregateId: event.aggregateId,
              aggregateType: STEP_DISPATCH_AGGREGATE_TYPE,
              type: STEP_DISPATCH_FAILED_TYPE,
              payload: {
                stepKind: rawStepKindOf(event.payload),
                error: INVALID_DISPATCH_PAYLOAD_ERROR,
                attempt: 1,
              },
            });
            // skip: invalid payload already recorded via step.dispatch-failed above, nothing left to dispatch
            return;
          }
          const payload = parsed.data;
          const result =
            payload.stepKind === "webhook.send"
              ? await performWebhookDispatch(payload.spec, {
                  tenantId: event.tenantId,
                  userId: event.metadata.userId || SYSTEM_USER_ID,
                  secrets: ctx.secrets,
                })
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
