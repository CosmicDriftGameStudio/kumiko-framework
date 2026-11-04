import { piiCiphertextMaxLengthFor } from "@cosmicdrift/kumiko-framework/crypto";
import * as z from "zod";
import {
  CHANNEL_WHATSAPP_FEATURE,
  WHATSAPP_BUTTON_PAYLOAD_MAX_CHARS,
  WHATSAPP_MESSAGE_TYPES,
  WHATSAPP_STATUS_KINDS,
  WHATSAPP_TEXT_MAX_CHARS,
} from "./constants.ts";

export const WHATSAPP_MESSAGE_AGGREGATE_TYPE = "whatsapp-message" as const;
export const WHATSAPP_STATUS_AGGREGATE_TYPE = "whatsapp-status" as const;

export const WHATSAPP_MESSAGE_RECEIVED_EVENT_SHORT = "message-received" as const;
export const WHATSAPP_STATUS_UPDATED_EVENT_SHORT = "status-updated" as const;
export const WHATSAPP_THROTTLED_EVENT_SHORT = "throttled" as const;

export const WHATSAPP_MESSAGE_RECEIVED_EVENT_QN =
  `${CHANNEL_WHATSAPP_FEATURE}:event:${WHATSAPP_MESSAGE_RECEIVED_EVENT_SHORT}` as const;
export const WHATSAPP_STATUS_UPDATED_EVENT_QN =
  `${CHANNEL_WHATSAPP_FEATURE}:event:${WHATSAPP_STATUS_UPDATED_EVENT_SHORT}` as const;
export const WHATSAPP_THROTTLED_EVENT_QN =
  `${CHANNEL_WHATSAPP_FEATURE}:event:${WHATSAPP_THROTTLED_EVENT_SHORT}` as const;

const E164_MAX_CHARS = 32;
const WAMID_MAX_CHARS = 256;
const PHONE_NUMBER_ID_MAX_CHARS = 64;
export const RAW_STATUS_MAX_CHARS = 64;

// What the webhook route hands to the write handlers: normalized, still plaintext.
export const receiveMessageInputSchema = z.object({
  phoneNumberId: z.string().min(1).max(PHONE_NUMBER_ID_MAX_CHARS),
  wamid: z.string().min(1).max(WAMID_MAX_CHARS),
  from: z.string().min(1).max(E164_MAX_CHARS),
  timestampIso: z.string().min(1),
  messageType: z.enum(WHATSAPP_MESSAGE_TYPES),
  text: z.string().max(WHATSAPP_TEXT_MAX_CHARS).nullable(),
  buttonPayload: z.string().max(WHATSAPP_BUTTON_PAYLOAD_MAX_CHARS).nullable(),
  contextWamid: z.string().max(WAMID_MAX_CHARS).nullable(),
  mediaId: z.string().max(WAMID_MAX_CHARS).nullable(),
  mimeType: z.string().max(255).nullable(),
});
export type ReceiveMessageInput = z.infer<typeof receiveMessageInputSchema>;

export const recordStatusInputSchema = z.object({
  phoneNumberId: z.string().min(1).max(PHONE_NUMBER_ID_MAX_CHARS),
  wamid: z.string().min(1).max(WAMID_MAX_CHARS),
  status: z.enum(WHATSAPP_STATUS_KINDS),
  // Meta's own status word; only keys the stream of an unrecognised status, never stored in the event.
  rawStatus: z.string().max(RAW_STATUS_MAX_CHARS).nullable(),
  timestampIso: z.string().min(1),
  recipient: z.string().min(1).max(E164_MAX_CHARS),
  errorCode: z.number().int().nullable(),
});
export type RecordStatusInput = z.infer<typeof recordStatusInputSchema>;

// Event payloads: sender and recipient numbers, message text and button payloads are
// PII and stored as tenant-key ciphertext (see pii.ts).
export const messageReceivedPayloadSchema = z.object({
  phoneNumberId: receiveMessageInputSchema.shape.phoneNumberId,
  wamid: receiveMessageInputSchema.shape.wamid,
  from: z.string().min(1).max(piiCiphertextMaxLengthFor(E164_MAX_CHARS)),
  timestampIso: z.string().min(1),
  messageType: receiveMessageInputSchema.shape.messageType,
  text: z.string().max(piiCiphertextMaxLengthFor(WHATSAPP_TEXT_MAX_CHARS)).nullable(),
  buttonPayload: z
    .string()
    .max(piiCiphertextMaxLengthFor(WHATSAPP_BUTTON_PAYLOAD_MAX_CHARS))
    .nullable(),
  contextWamid: receiveMessageInputSchema.shape.contextWamid,
  mediaId: receiveMessageInputSchema.shape.mediaId,
  mimeType: receiveMessageInputSchema.shape.mimeType,
});
export type MessageReceivedPayload = z.infer<typeof messageReceivedPayloadSchema>;

export const statusUpdatedPayloadSchema = z.object({
  phoneNumberId: recordStatusInputSchema.shape.phoneNumberId,
  wamid: recordStatusInputSchema.shape.wamid,
  status: recordStatusInputSchema.shape.status,
  timestampIso: z.string().min(1),
  recipient: z.string().min(1).max(piiCiphertextMaxLengthFor(E164_MAX_CHARS)),
  errorCode: recordStatusInputSchema.shape.errorCode,
});
export type StatusUpdatedPayload = z.infer<typeof statusUpdatedPayloadSchema>;

export const throttledPayloadSchema = z.object({
  phoneNumberId: receiveMessageInputSchema.shape.phoneNumberId,
  wamid: receiveMessageInputSchema.shape.wamid,
  from: z.string().min(1).max(piiCiphertextMaxLengthFor(E164_MAX_CHARS)),
  timestampIso: z.string().min(1),
  retryAfterSeconds: z.number().int().min(0),
});
export type ThrottledPayload = z.infer<typeof throttledPayloadSchema>;
