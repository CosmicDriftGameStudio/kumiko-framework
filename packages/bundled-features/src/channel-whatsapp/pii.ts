import {
  configuredPiiSubjectKms,
  decryptPiiValueForSubject,
  encryptPiiValueForSubject,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { TenantId } from "@cosmicdrift/kumiko-types/identifiers";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";

// The sender has no user account, so the tenant key is the subject (as for inbound mail):
// destroying the tenant shreds the key and every stored number, text and payload with it.
// The field name is part of the ciphertext's AAD and must match between encrypt and decrypt.
export const WhatsappPiiFields = {
  receivedFrom: "channel-whatsapp.message-received.from",
  receivedText: "channel-whatsapp.message-received.text",
  receivedButtonPayload: "channel-whatsapp.message-received.buttonPayload",
  statusRecipient: "channel-whatsapp.status-updated.recipient",
  throttledFrom: "channel-whatsapp.throttled.from",
} as const;

export type WhatsappPiiField = (typeof WhatsappPiiFields)[keyof typeof WhatsappPiiFields];

/** Without a configured PII KMS the value passes through, like every other event-sourced inbound path. */
export async function encryptWhatsappPii(
  tenantId: TenantId,
  field: WhatsappPiiField,
  value: string,
  requestId: string,
): Promise<string> {
  const kms = configuredPiiSubjectKms();
  if (!kms) return value;
  return encryptPiiValueForSubject(
    kms,
    { kind: "tenant", tenantId },
    value,
    { requestId, tenantId },
    field,
  );
}

export async function decryptWhatsappPii(
  tenantId: TenantId,
  field: WhatsappPiiField,
  value: string,
): Promise<string> {
  const kms = configuredPiiSubjectKms();
  if (!kms) return value;
  return decryptPiiValueForSubject(
    kms,
    value,
    { requestId: `channel-whatsapp:decrypt:${field}`, tenantId },
    field,
  );
}

export type DecryptedWhatsappMessage = {
  readonly from: string;
  readonly text: string | null;
  readonly buttonPayload: string | null;
};

export type DecryptedWhatsappStatus = { readonly recipient: string };
export type DecryptedWhatsappThrottled = { readonly from: string };

/** Plaintext recipient of a `status-updated` event payload. */
export async function readWhatsappStatusPii(
  tenantId: TenantId,
  payload: unknown,
): Promise<DecryptedWhatsappStatus> {
  const recipient = propertyOf(payload, "recipient");
  if (typeof recipient !== "string") throw new Error("channel-whatsapp: payload has no recipient");
  return {
    recipient: await decryptWhatsappPii(tenantId, WhatsappPiiFields.statusRecipient, recipient),
  };
}

/** Plaintext sender of a `throttled` event payload. */
export async function readWhatsappThrottledPii(
  tenantId: TenantId,
  payload: unknown,
): Promise<DecryptedWhatsappThrottled> {
  const from = propertyOf(payload, "from");
  if (typeof from !== "string") throw new Error("channel-whatsapp: payload has no sender");
  return { from: await decryptWhatsappPii(tenantId, WhatsappPiiFields.throttledFrom, from) };
}

/**
 * Plaintext of the PII fields of a `message-received` event payload, for the consumer.
 * A tenant that was destroyed yields the erased sentinel instead of the value.
 */
export async function readWhatsappMessagePii(
  tenantId: TenantId,
  payload: unknown,
): Promise<DecryptedWhatsappMessage> {
  const from = propertyOf(payload, "from");
  const text = propertyOf(payload, "text");
  const buttonPayload = propertyOf(payload, "buttonPayload");
  if (typeof from !== "string") throw new Error("channel-whatsapp: payload has no sender");
  return {
    from: await decryptWhatsappPii(tenantId, WhatsappPiiFields.receivedFrom, from),
    text:
      typeof text === "string"
        ? await decryptWhatsappPii(tenantId, WhatsappPiiFields.receivedText, text)
        : null,
    buttonPayload:
      typeof buttonPayload === "string"
        ? await decryptWhatsappPii(tenantId, WhatsappPiiFields.receivedButtonPayload, buttonPayload)
        : null,
  };
}
