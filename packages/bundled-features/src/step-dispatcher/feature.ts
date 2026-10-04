// step-dispatcher — bundled-feature that drains deferred Tier-2 step
// requests (webhook.send, mail.send, ...) after their TX commits.
//
// Listens on the `kumiko:system:step.dispatch-requested` system event
// (registry-bypassed, see SYSTEM_EVENT_PREFIX).
// Performs the side-effect and emits `kumiko:system:step.dispatched`
// or `kumiko:system:step.dispatch-failed` back onto the same stream so
// the audit trail lives in the event log only — no separate status table.

import { requestContext } from "@cosmicdrift/kumiko-framework/api";
import {
  configuredPiiSubjectKms,
  decryptPiiValueForSubject,
  isPiiCiphertext,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
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
import { redactEmailAddresses } from "../shared/redact.js";
import { type MailSpec, mailSpecSchema, performMailDispatch } from "./mail-runner.js";
import {
  performWebhookDispatch,
  WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR,
  WEBHOOK_AUTH_SECRET_NAMESPACE_OPTIONS,
  type WebhookSpec,
  webhookSpecSchema,
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

// PII fields of the flat payload are ciphertext under the per-dispatch
// record key (system-event-pii.ts). `to`/`headersJson`/`bodyJson` are JSON
// strings because event PII encryption only handles top-level strings.
// Runtime-validated instead of cast — `event.payload` is `unknown` at the
// MSP-apply boundary, so a payload in another shape must end as
// dispatch-failed, never reach the runners.
const dispatchRequestedPayloadSchema = z.discriminatedUnion("stepKind", [
  z.object({
    stepKind: z.literal("webhook.send"),
    url: z.string(),
    method: webhookSpecSchema.shape.method,
    headersJson: z.string(),
    bodyJson: z.string().optional(),
    auth: webhookSpecSchema.shape.auth,
    retry: z.object({ times: z.number(), backoff: z.enum(["exponential", "linear"]) }).optional(),
  }),
  z.object({
    stepKind: z.literal("mail.send"),
    to: z.string(),
    subject: z.string(),
    body: z.string(),
    from: z.string().optional(),
  }),
]);

type DispatchRequestedPayload = z.infer<typeof dispatchRequestedPayloadSchema>;

// zod issue messages can echo the invalid value (e.g. a rejected url) back
// into the tenant-visible dispatch-failed event — keep this generic.
const INVALID_DISPATCH_PAYLOAD_ERROR = "invalid dispatch payload";
const PAYLOAD_UNREADABLE_ERROR = "dispatch payload is not readable";
// Adapter errors (e.g. SMTP 550) usually echo the recipient address; the
// dispatch-failed text outlives the payload erase, so only this is persisted.
const MAIL_DELIVERY_FAILED_ERROR = "mail delivery failed";
const PAYLOAD_ERASED_ERROR = "dispatch payload erased before an outcome was recorded";

const rawStepKindSchema = z.object({ stepKind: z.string() });

function rawStepKindOf(payload: unknown): string {
  const parsed = rawStepKindSchema.safeParse(payload);
  return parsed.success ? parsed.data.stepKind : "unknown";
}

const jsonStringSchema = z.string().transform((raw, refinementCtx) => {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed;
  } catch {
    refinementCtx.addIssue({ code: "custom", message: "invalid json" });
    return z.NEVER;
  }
});

const headersJsonSchema = jsonStringSchema.pipe(z.record(z.string(), z.string()));
const mailToJsonSchema = jsonStringSchema.pipe(mailSpecSchema.shape.to);

type PayloadFieldName = "to" | "subject" | "body" | "from" | "url" | "headersJson" | "bodyJson";

function piiFieldsOf(payload: DispatchRequestedPayload): readonly PayloadFieldName[] {
  return payload.stepKind === "mail.send"
    ? ["to", "subject", "body", "from"]
    : ["url", "headersJson", "bodyJson"];
}

function payloadFieldValue(
  payload: DispatchRequestedPayload,
  field: PayloadFieldName,
): string | undefined {
  const values: Readonly<Partial<Record<PayloadFieldName, string>>> =
    payload.stepKind === "mail.send"
      ? { to: payload.to, subject: payload.subject, body: payload.body, from: payload.from }
      : { url: payload.url, headersJson: payload.headersJson, bodyJson: payload.bodyJson };
  return values[field];
}

type ReadPayloadResult =
  | { readonly kind: "ready"; readonly fields: Readonly<Partial<Record<PayloadFieldName, string>>> }
  | { readonly kind: "erased" }
  | { readonly kind: "unreadable" };

async function readPayloadFields(payload: DispatchRequestedPayload): Promise<ReadPayloadResult> {
  const kms = configuredPiiSubjectKms();
  const requestId = requestContext.get()?.requestId ?? "step-dispatcher";
  const fields: Partial<Record<PayloadFieldName, string>> = {};
  for (const field of piiFieldsOf(payload)) {
    const value = payloadFieldValue(payload, field);
    if (value === undefined) continue;
    if (!isPiiCiphertext(value)) {
      fields[field] = value;
      continue;
    }
    if (!kms) return { kind: "unreadable" };
    const plain = await decryptPiiValueForSubject(kms, value, { requestId }, field);
    if (plain === PII_ERASED_SENTINEL) return { kind: "erased" };
    fields[field] = plain;
  }
  return { kind: "ready", fields };
}

type DispatchSpec =
  | { readonly stepKind: "mail.send"; readonly spec: MailSpec }
  | { readonly stepKind: "webhook.send"; readonly spec: WebhookSpec };

// Parse failures return null — the caller records a generic error, never the
// (decrypted) values.
function buildDispatchSpec(
  payload: DispatchRequestedPayload,
  fields: Readonly<Partial<Record<PayloadFieldName, string>>>,
): DispatchSpec | null {
  if (payload.stepKind === "mail.send") {
    const to = mailToJsonSchema.safeParse(fields.to);
    if (!to.success || fields.subject === undefined || fields.body === undefined) return null;
    return {
      stepKind: "mail.send",
      spec: {
        to: to.data,
        subject: fields.subject,
        body: fields.body,
        ...(fields.from !== undefined && { from: fields.from }),
      },
    };
  }
  const headers = headersJsonSchema.safeParse(fields.headersJson);
  if (!headers.success || fields.url === undefined) return null;
  let body: unknown;
  if (fields.bodyJson !== undefined) {
    const parsedBody = jsonStringSchema.safeParse(fields.bodyJson);
    if (!parsedBody.success) return null;
    body = parsedBody.data;
  }
  return {
    stepKind: "webhook.send",
    spec: {
      url: fields.url,
      method: payload.method,
      headers: headers.data,
      ...(body !== undefined && { body }),
      ...(payload.auth && { auth: payload.auth }),
    },
  };
}

export function createStepDispatcherFeature(): FeatureDefinition {
  return defineFeature("step-dispatcher", (r) => {
    r.describe(
      "Internal system feature that drains deferred Tier-2 side-effects (currently `webhook.send` and `mail.send`) after their originating transaction commits. Listens via `r.multiStreamProjection` on the `kumiko:system:step.dispatch-requested` system event, performs the actual HTTP or mail delivery, then appends `kumiko:system:step.dispatched` or `kumiko:system:step.dispatch-failed` back onto the same stream so the outcome is recorded in the event log without a separate status table. Mount this feature explicitly via `createStepDispatcherFeature()` in your app's feature list alongside any features that use `r.step.webhook.send` or `r.step.mail.send`. Requires the `secrets` feature (`createSecretsFeature()`) to be mounted — `webhook.send` auth resolves per-tenant through it, under `step-dispatcher:webhook-auth.<name>`.",
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

          // Outcome events are plaintext and generic; the request payload's
          // per-dispatch key is erased right after, so the PII dies with the
          // dispatch instead of living in the event log.
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
            await kms?.eraseKey(
              { kind: "record", entity: STEP_DISPATCH_AGGREGATE_TYPE, id: event.aggregateId },
              { requestId, eraseReason: "step-dispatch-outcome-recorded" },
            );
          };
          const recordFailure = (stepKind: string, error: string) =>
            recordOutcome(STEP_DISPATCH_FAILED_TYPE, { stepKind, error, attempt: 1 });

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
            const stream = await ctx.loadAggregate(event.aggregateId);
            const hasOutcome = stream.some(
              (e) => e.type === STEP_DISPATCHED_TYPE || e.type === STEP_DISPATCH_FAILED_TYPE,
            );
            // skip: redelivery after the key was erased — the outcome is already recorded
            if (hasOutcome) return;
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
