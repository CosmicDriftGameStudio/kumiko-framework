import { requestContext } from "@cosmicdrift/kumiko-framework/api";
import {
  configuredPiiSubjectKms,
  decryptPiiValueForSubject,
  isPiiCiphertext,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import * as z from "zod";
import { type MailSpec, mailSpecSchema } from "./mail-runner.js";
import { type WebhookSpec, webhookSpecSchema } from "./webhook-runner.js";

// PII fields of the flat payload are ciphertext under the per-dispatch
// record key (system-event-pii.ts). `to`/`headersJson`/`bodyJson` are JSON
// strings because event PII encryption only handles top-level strings.
// Runtime-validated instead of cast — `event.payload` is `unknown` at the
// MSP-apply boundary, so a payload in another shape must end as
// dispatch-failed, never reach the runners.
export const dispatchRequestedPayloadSchema = z.discriminatedUnion("stepKind", [
  z.object({
    stepKind: z.literal("webhook.send"),
    url: z.string(),
    method: webhookSpecSchema.shape.method,
    headersJson: z.string(),
    bodyJson: z.string().optional(),
    auth: webhookSpecSchema.shape.auth,
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

const rawStepKindSchema = z.object({ stepKind: z.string() });

export function rawStepKindOf(payload: unknown): string {
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

export async function readPayloadFields(
  payload: DispatchRequestedPayload,
): Promise<ReadPayloadResult> {
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
export function buildDispatchSpec(
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
