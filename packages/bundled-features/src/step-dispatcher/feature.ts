// step-dispatcher — bundled-feature that drains deferred Tier-2 step
// requests (webhook.send, mail.send, ...) after their TX commits.
//
// Listens on the `kumiko:system:step.dispatch-requested` system event
// (registry-bypassed, see SYSTEM_EVENT_PREFIX).
// Performs the side-effect and emits `kumiko:system:step.dispatched`
// or `kumiko:system:step.dispatch-failed` back onto the same stream so
// the audit trail lives in the event log only — no separate status table.

import { requestContext } from "@cosmicdrift/kumiko-framework/api";
import { configuredPiiSubjectKms } from "@cosmicdrift/kumiko-framework/crypto";
import {
  defineFeature,
  type FeatureDefinition,
  STEP_DISPATCH_AGGREGATE_TYPE,
  STEP_DISPATCH_FAILED_TYPE,
  STEP_DISPATCH_REQUESTED_TYPE,
  STEP_DISPATCHED_TYPE,
} from "@cosmicdrift/kumiko-framework/engine";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import { SYSTEM_USER_ID } from "@cosmicdrift/kumiko-types/identifiers";
import * as z from "zod";
import { redactEmailAddresses } from "../shared/index.js";
import {
  buildDispatchSpec,
  dispatchRequestedPayloadSchema,
  rawStepKindOf,
  readPayloadFields,
} from "./dispatch-payload.js";
import { performMailDispatch } from "./mail-runner.js";
import {
  performWebhookDispatch,
  WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR,
  WEBHOOK_AUTH_SECRET_NAMESPACE_OPTIONS,
} from "./webhook-runner.js";

const log = createFallbackLogger("step-dispatcher");

export const stepDispatcherEnvSchema = z.object({
  [WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR]: z
    .string()
    .optional()
    .describe(
      "Comma-separated operator allowlist of private/internal hosts (e.g. a local webhook-receiver for dev/test) that bypass the public-address check for webhook.send targets. Never a tenant-config value.",
    ),
});

export { STEP_DISPATCH_AGGREGATE_TYPE };

// zod issue messages can echo the invalid value (e.g. a rejected url) back
// into the tenant-visible dispatch-failed event — keep this generic.
const INVALID_DISPATCH_PAYLOAD_ERROR = "invalid dispatch payload";
const PAYLOAD_UNREADABLE_ERROR = "dispatch payload is not readable";
// Adapter errors (e.g. SMTP 550) usually echo the recipient address; the
// dispatch-failed text outlives the payload erase, so only this is persisted.
const MAIL_DELIVERY_FAILED_ERROR = "mail delivery failed";
const PAYLOAD_ERASED_ERROR = "dispatch payload erased before an outcome was recorded";

function isDispatchOutcome(e: { readonly type: string }): boolean {
  return e.type === STEP_DISPATCHED_TYPE || e.type === STEP_DISPATCH_FAILED_TYPE;
}

export function createStepDispatcherFeature(): FeatureDefinition {
  return defineFeature("step-dispatcher", (r) => {
    r.describe(
      "Internal system feature that drains deferred Tier-2 side-effects (currently `webhook.send` and `mail.send`) after their originating transaction commits. Listens via `r.multiStreamProjection` on the `kumiko:system:step.dispatch-requested` system event, performs the actual HTTP or mail delivery, then appends `kumiko:system:step.dispatched` or `kumiko:system:step.dispatch-failed` back onto the same stream so the outcome is recorded in the event log without a separate status table. Mount this feature explicitly via `createStepDispatcherFeature()` in your app's feature list alongside any features that use `r.step.webhook.send` or `r.step.mail.send`. Requires the `secrets` feature (`createSecretsFeature()`) to be mounted — `webhook.send` auth resolves per-tenant through it, under `step-dispatcher:webhook-auth.<name>`. Every `webhook.send` request carries `Idempotency-Key: <dispatch stream id>`, stable across redeliveries of the same dispatch request; an explicit `Idempotency-Key` in `headers` takes precedence.",
    );
    r.secretNamespace("webhook-auth", WEBHOOK_AUTH_SECRET_NAMESPACE_OPTIONS);
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
          const kms = configuredPiiSubjectKms();
          const requestId = requestContext.get()?.requestId ?? "step-dispatcher";

          const eraseDispatchKey = async (): Promise<void> => {
            await kms?.eraseKey(
              { kind: "record", entity: STEP_DISPATCH_AGGREGATE_TYPE, id: event.aggregateId },
              { requestId, eraseReason: "step-dispatch-outcome-recorded" },
            );
          };

          // Outcome events are plaintext and generic; the request payload's
          // per-dispatch key is erased right after, so the PII dies with the
          // dispatch instead of living in the event log. The outcome is
          // appended before the erase on purpose: if the erase throws, the
          // outcome survives and a redelivery only repeats the erase. A crash
          // between the send and the outcome append still re-sends under the
          // same Idempotency-Key — the one remaining double-send case.
          const recordOutcome = async (
            type: typeof STEP_DISPATCHED_TYPE | typeof STEP_DISPATCH_FAILED_TYPE,
            payload: Record<string, unknown>,
          ): Promise<void> => {
            await ctx.unsafeAppendEvent({
              aggregateId: event.aggregateId,
              aggregateType: STEP_DISPATCH_AGGREGATE_TYPE,
              type,
              payload,
            });
            await eraseDispatchKey();
          };
          const recordFailure = (stepKind: string, error: string) =>
            recordOutcome(STEP_DISPATCH_FAILED_TYPE, { stepKind, error, attempt: 1 });

          const stream = await ctx.loadAggregate(event.aggregateId);
          if (stream.some(isDispatchOutcome)) {
            await eraseDispatchKey();
            // skip: redelivery after an outcome was recorded — only the erase is repeated
            return;
          }

          const parsed = dispatchRequestedPayloadSchema.safeParse(event.payload);
          if (!parsed.success) {
            await recordFailure(rawStepKindOf(event.payload), INVALID_DISPATCH_PAYLOAD_ERROR);
            // skip: invalid payload already recorded via step.dispatch-failed above, nothing left to dispatch
            return;
          }
          const payload = parsed.data;

          const read = await readPayloadFields(payload);
          if (read.kind === "unreadable") {
            await recordFailure(payload.stepKind, PAYLOAD_UNREADABLE_ERROR);
            // skip: unreadable payload already recorded via step.dispatch-failed above
            return;
          }
          if (read.kind === "erased") {
            await recordFailure(payload.stepKind, PAYLOAD_ERASED_ERROR);
            // skip: erased payload recorded via step.dispatch-failed above
            return;
          }

          const dispatchSpec = buildDispatchSpec(payload, read.fields);
          if (!dispatchSpec) {
            await recordFailure(payload.stepKind, INVALID_DISPATCH_PAYLOAD_ERROR);
            // skip: unparseable payload already recorded via step.dispatch-failed above
            return;
          }
          const result =
            dispatchSpec.stepKind === "webhook.send"
              ? await performWebhookDispatch(dispatchSpec.spec, {
                  tenantId: event.tenantId,
                  userId: event.metadata.userId || SYSTEM_USER_ID,
                  secrets: ctx.secrets,
                  idempotencyKey: event.aggregateId,
                })
              : await performMailDispatch(dispatchSpec.spec);
          if (result.ok) {
            await recordOutcome(STEP_DISPATCHED_TYPE, {
              stepKind: payload.stepKind,
              status: result.status,
            });
          } else {
            if (payload.stepKind === "mail.send") {
              log.warn("mail dispatch failed", {
                aggregateId: event.aggregateId,
                reason: redactEmailAddresses(result.error),
              });
              await recordFailure(payload.stepKind, MAIL_DELIVERY_FAILED_ERROR);
            } else {
              await recordFailure(payload.stepKind, result.error);
            }
          }
        },
      },
    });
  });
}
