import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import {
  WHATSAPP_BUTTON_PAYLOAD_MAX_CHARS,
  WHATSAPP_STATUS_KINDS,
  WHATSAPP_TEXT_MAX_CHARS,
  type WhatsappStatusKind,
} from "./constants.ts";
import {
  MIME_TYPE_MAX_CHARS,
  PHONE_NUMBER_ID_MAX_CHARS,
  RAW_STATUS_MAX_CHARS,
  type ReceiveMessageInput,
  type RecordStatusInput,
  WAMID_MAX_CHARS,
} from "./events.ts";

// Meta adds fields and message types without notice. Every nested object is `.catch(undefined)`,
// so one unexpected shape costs that detail and not the whole message.
const mediaSchema = z.object({ id: z.string().optional(), mime_type: z.string().optional() });
const messageSchema = z.object({
  id: z.string().min(1),
  from: z.string(),
  timestamp: z.string().optional(),
  type: z.string().optional(),
  text: z.object({ body: z.string() }).optional().catch(undefined),
  audio: mediaSchema.optional().catch(undefined),
  image: mediaSchema.optional().catch(undefined),
  interactive: z
    .object({
      button_reply: z
        .object({ id: z.string(), title: z.string().optional() })
        .optional()
        .catch(undefined),
    })
    .optional()
    .catch(undefined),
  button: z
    .object({ payload: z.string().optional(), text: z.string().optional() })
    .optional()
    .catch(undefined),
  context: z.object({ id: z.string().optional() }).optional().catch(undefined),
});
type MetaMessage = z.infer<typeof messageSchema>;

const statusSchema = z.object({
  id: z.string().min(1),
  status: z.string().optional(),
  timestamp: z.string().optional(),
  recipient_id: z.string().optional(),
  errors: z
    .array(z.object({ code: z.number().optional() }))
    .optional()
    .catch(undefined),
});
type MetaStatus = z.infer<typeof statusSchema>;

const changeValueSchema = z.object({
  metadata: z.object({ phone_number_id: z.string().optional() }).optional().catch(undefined),
  messages: z.array(z.unknown()).optional().catch(undefined),
  statuses: z.array(z.unknown()).optional().catch(undefined),
});

const webhookSchema = z.object({
  entry: z
    .array(
      z.object({
        changes: z
          .array(z.object({ value: changeValueSchema.optional().catch(undefined) }))
          .optional()
          .catch(undefined),
      }),
    )
    .optional()
    .catch(undefined),
});

export type NormalizedWebhook = {
  readonly messages: readonly ReceiveMessageInput[];
  readonly statuses: readonly RecordStatusInput[];
  // Entries that carried no usable id, sender or phone number id, or an id longer than the event
  // schema allows; nothing a redelivery could fix.
  readonly skipped: number;
};

// Temporal.Instant throws beyond 8.64e15 epoch milliseconds.
const MAX_EPOCH_SECONDS = 8.64e12;

const DIGITS_PATTERN = /^\d{5,20}$/;

function toE164(raw: string): string | null {
  const digits = raw.replace(/^\+/, "");
  return DIGITS_PATTERN.test(digits) ? `+${digits}` : null;
}

function toIso(unixSeconds: string | undefined, fallbackIso: string): string {
  const seconds = Number(unixSeconds);
  return unixSeconds !== undefined &&
    Number.isFinite(seconds) &&
    seconds > 0 &&
    seconds <= MAX_EPOCH_SECONDS
    ? Temporal.Instant.fromEpochMilliseconds(Math.floor(seconds) * 1000).toString()
    : fallbackIso;
}

function clip(value: string, maxChars: number): string {
  return value.length > maxChars ? value.slice(0, maxChars) : value;
}

type MessageContent = Pick<
  ReceiveMessageInput,
  "messageType" | "text" | "buttonPayload" | "mediaId" | "mimeType"
>;

const NO_CONTENT = { text: null, buttonPayload: null, mediaId: null, mimeType: null };

function optionalClip(value: string | undefined, maxChars: number): string | null {
  return value === undefined ? null : clip(value, maxChars);
}

// A truncated id would point at another object, so an oversized one is dropped, not clipped.
function optionalId(value: string | undefined): string | null {
  return value === undefined || value.length > WAMID_MAX_CHARS ? null : value;
}

function buttonContentOf(message: MetaMessage): MessageContent | null {
  const reply = message.interactive?.button_reply;
  if (message.type === "interactive" && reply) {
    return {
      ...NO_CONTENT,
      messageType: "interactive_button",
      text: optionalClip(reply.title, WHATSAPP_TEXT_MAX_CHARS),
      buttonPayload: clip(reply.id, WHATSAPP_BUTTON_PAYLOAD_MAX_CHARS),
    };
  }
  // Quick-reply buttons of a template arrive as type "button".
  if (message.type === "button" && message.button?.payload !== undefined) {
    return {
      ...NO_CONTENT,
      messageType: "interactive_button",
      text: optionalClip(message.button.text, WHATSAPP_TEXT_MAX_CHARS),
      buttonPayload: clip(message.button.payload, WHATSAPP_BUTTON_PAYLOAD_MAX_CHARS),
    };
  }
  return null;
}

function mediaContentOf(message: MetaMessage): MessageContent | null {
  if (message.type !== "audio" && message.type !== "image") return null;
  const media = message.type === "audio" ? message.audio : message.image;
  if (!media) return null;
  return {
    ...NO_CONTENT,
    messageType: message.type,
    mediaId: optionalId(media.id),
    mimeType: optionalClip(media.mime_type, MIME_TYPE_MAX_CHARS),
  };
}

function contentOf(message: MetaMessage): MessageContent {
  if (message.type === "text" && message.text) {
    return {
      ...NO_CONTENT,
      messageType: "text",
      text: clip(message.text.body, WHATSAPP_TEXT_MAX_CHARS),
    };
  }
  return (
    buttonContentOf(message) ?? mediaContentOf(message) ?? { ...NO_CONTENT, messageType: "other" }
  );
}

function normalizeMessage(
  raw: unknown,
  phoneNumberId: string,
  nowIso: string,
): ReceiveMessageInput | null {
  const parsed = messageSchema.safeParse(raw);
  if (!parsed.success) return null;
  const message = parsed.data;
  if (message.id.length > WAMID_MAX_CHARS || phoneNumberId.length > PHONE_NUMBER_ID_MAX_CHARS) {
    return null;
  }
  const from = toE164(message.from);
  if (from === null) return null;
  return {
    phoneNumberId,
    wamid: message.id,
    from,
    timestampIso: toIso(message.timestamp, nowIso),
    contextWamid: optionalId(message.context?.id),
    ...contentOf(message),
  };
}

function statusKindOf(raw: string | undefined): WhatsappStatusKind {
  return WHATSAPP_STATUS_KINDS.find((kind) => kind === raw) ?? "other";
}

function normalizeStatus(
  raw: unknown,
  phoneNumberId: string,
  nowIso: string,
): RecordStatusInput | null {
  const parsed = statusSchema.safeParse(raw);
  if (!parsed.success) return null;
  const status: MetaStatus = parsed.data;
  if (status.id.length > WAMID_MAX_CHARS || phoneNumberId.length > PHONE_NUMBER_ID_MAX_CHARS) {
    return null;
  }
  const recipient = toE164(status.recipient_id ?? "");
  if (recipient === null) return null;
  return {
    phoneNumberId,
    wamid: status.id,
    status: statusKindOf(status.status),
    rawStatus: status.status === undefined ? null : clip(status.status, RAW_STATUS_MAX_CHARS),
    timestampIso: toIso(status.timestamp, nowIso),
    recipient,
    errorCode: status.errors?.[0]?.code ?? null,
  };
}

export function normalizeWhatsappWebhook(body: unknown, nowIso: string): NormalizedWebhook {
  const parsed = webhookSchema.safeParse(body);
  const messages: ReceiveMessageInput[] = [];
  const statuses: RecordStatusInput[] = [];
  let skipped = 0;
  if (!parsed.success) return { messages, statuses, skipped };
  for (const entry of parsed.data.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      for (const raw of value?.messages ?? []) {
        const normalized = phoneNumberId ? normalizeMessage(raw, phoneNumberId, nowIso) : null;
        if (normalized) messages.push(normalized);
        else skipped += 1;
      }
      for (const raw of value?.statuses ?? []) {
        const normalized = phoneNumberId ? normalizeStatus(raw, phoneNumberId, nowIso) : null;
        if (normalized) statuses.push(normalized);
        else skipped += 1;
      }
    }
  }
  return { messages, statuses, skipped };
}
