import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { CHANNEL_WHATSAPP_FEATURE } from "./constants.ts";
import {
  messageReceivedPayloadSchema,
  statusUpdatedPayloadSchema,
  throttledPayloadSchema,
  WHATSAPP_MESSAGE_RECEIVED_EVENT_SHORT,
  WHATSAPP_STATUS_UPDATED_EVENT_SHORT,
  WHATSAPP_THROTTLED_EVENT_SHORT,
} from "./events.ts";
import { createReceiveMessageHandler, createRecordStatusHandler } from "./inbound-handlers.ts";
import { type ChannelWhatsappOptions, resolveWhatsappOptions } from "./options.ts";

const MAX_SECRET_CHARS = 512;
const secretValueSchema = z.string().min(1).max(MAX_SECRET_CHARS);

export function createChannelWhatsappFeature(
  options: ChannelWhatsappOptions = {},
): FeatureDefinition {
  const resolved = resolveWhatsappOptions(options);
  return defineFeature(CHANNEL_WHATSAPP_FEATURE, (r) => {
    r.describe(
      "WhatsApp Business (Meta Cloud API) as a two-way channel, not a delivery channel. Inbound: mount `createWhatsappWebhookRoutes()` via `extraRoutes` (default path `/api/channel-whatsapp/webhook/:tenantId`, the tenant id is part of the URL because the secrets are tenant-scoped); GET answers Meta's `hub.challenge` handshake, POST checks `X-Hub-Signature-256` over the raw body and normalizes each message and status. Events: `channel-whatsapp:event:message-received` (sender, wamid, type text|audio|image|interactive_button|other, text, button payload, `contextWamid`, media id and mime type, `phoneNumberId`), `status-updated` (sent|delivered|read|failed|other) and `throttled` (sender over the per-number limit). Sender number, text, button payload and status recipient are PII, stored as tenant-key ciphertext; read them with `readWhatsappMessagePii`. A redelivered wamid is stored once and answered 200; a failed dispatch answers 500 so Meta redelivers. Outbound: `createWhatsappClient(opts)` gives `sendText`, `sendTemplate`, `sendButtons`, `sendMedia` (each takes the sending `phoneNumberId` and answers `{ ok: true, wamid }` or a typed failure) and `fetchMedia` (media id to bytes and mime type; the URL from the Graph answer is checked against `allowedHosts` before the token is sent). Tenant secrets `channel-whatsapp:secret:access-token`, `app-secret` and `verify-token`. App options of `createChannelWhatsappFeature(opts)`: `apiBaseUrl`, `apiVersion` (default v21.0), `allowedHosts` (default graph.facebook.com and lookaside.fbsbx.com), `requireHttps` (default true; boot fails on a mismatch), `timeoutMs`, `mediaMaxBytes`, `transport` (in-memory Meta for tests), `senderRateLimits` (default 30 per hour and 200 per day per sender and tenant) and `rateLimit` (flood guard of the inbound handlers; cannot be disabled while a sender limit is set). Requires `secrets`. A worker-run job triggered by `message-received` attaches the business process.",
    );
    r.uiHints({
      displayLabel: "WhatsApp Channel",
      category: "notifications",
      recommended: false,
    });
    r.requires({ features: ["secrets"] });

    r.secret("accessToken", {
      label: { en: "WhatsApp access token" },
      hint: {
        en: "System-user access token of the Meta app. Used to send messages and to download media.",
      },
      redact: () => "••••••••",
      scope: "tenant",
      valueSchema: secretValueSchema,
    });
    r.secret("appSecret", {
      label: { en: "WhatsApp app secret" },
      hint: { en: "App secret of the Meta app. Verifies the signature of every incoming webhook." },
      redact: () => "••••••••",
      scope: "tenant",
      valueSchema: secretValueSchema,
    });
    r.secret("verifyToken", {
      label: { en: "WhatsApp verify token" },
      hint: {
        en: "Any string you also enter in the Meta webhook settings; answers Meta's subscription handshake.",
      },
      redact: () => "••••••••",
      scope: "tenant",
      valueSchema: secretValueSchema,
    });

    r.defineEvent(WHATSAPP_MESSAGE_RECEIVED_EVENT_SHORT, messageReceivedPayloadSchema, {
      piiFields: "none",
    });
    r.defineEvent(WHATSAPP_STATUS_UPDATED_EVENT_SHORT, statusUpdatedPayloadSchema, {
      piiFields: "none",
    });
    r.defineEvent(WHATSAPP_THROTTLED_EVENT_SHORT, throttledPayloadSchema, {
      piiFields: "none",
    });

    r.writeHandler(createReceiveMessageHandler(resolved));
    r.writeHandler(createRecordStatusHandler(resolved));
  });
}
