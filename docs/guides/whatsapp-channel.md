---
status: reference
verified: 2026-11-04
evidence: "kumiko-framework#4239; packages/bundled-features/src/channel-whatsapp; packages/bundled-features/src/channel-whatsapp/__tests__/whatsapp.integration.test.ts"
---

# WhatsApp (Meta Cloud API): inbound and outbound

`channel-whatsapp` is a two-way WhatsApp Business channel, not a delivery channel: it is not registered in `delivery` and `ctx.notify` does not reach it. Inbound messages arrive as events; sending is a client you call from your own code. Everything is tenant-scoped, so each tenant uses its own Meta app.

## Setup

```ts illustration
import {
  createChannelWhatsappFeature,
  createWhatsappWebhookRoutes,
} from "@cosmicdrift/kumiko-bundled-features/channel-whatsapp";

const whatsapp = createChannelWhatsappFeature();
// extraRoutes: [...createWhatsappWebhookRoutes()]
```

The feature requires `secrets`. The tenant stores three secrets: `channel-whatsapp:secret:access-token` (system-user token, sends messages and loads media), `channel-whatsapp:secret:app-secret` (signs the webhooks) and `channel-whatsapp:secret:verify-token` (answers the subscription handshake).

In the Meta app, subscribe the webhook to `https://<host>/api/channel-whatsapp/webhook/<tenantId>` (`createWhatsappWebhookRoutes({ path })` overrides the path, which must contain `:tenantId`).

## Inbound

- `GET` answers `hub.challenge` as `text/plain` when `hub.verify_token` matches.
- `POST` checks `X-Hub-Signature-256` (HMAC-SHA256 over the raw body). A malformed tenant id, an unknown tenant, a missing secret and a wrong signature all give the same 401.
- Each message becomes `channel-whatsapp:event:message-received`, each status `status-updated`. Unknown types become `other`; unknown fields are ignored.
- The aggregate id is derived from tenant and wamid. A redelivered message is stored once and answered 200. If a dispatch fails the route answers 500, so Meta redelivers; the dedupe makes that safe.
- No media is fetched in the request path. The event carries the media id and mime type; load the bytes later with `fetchMedia`.

Sender number, text, button payload and status recipient are PII. They are stored as tenant-key ciphertext (encrypted before the event is appended), so erasing the tenant key makes them unreadable. Read them with `readWhatsappMessagePii(tenantId, payload)`.

### Sender limit

Each sender gets a limit per tenant (default 30 per hour and 200 per day, `senderRateLimits`). A message over the limit is stored as `throttled` and answered 200, so Meta does not retry. The check runs after the wamid dedupe, so a redelivery costs no budget; statuses do not count. The handler also declares a large per-tenant flood limit (`rateLimit`); the factory refuses to disable it while a sender limit is set.

## Outbound

```ts illustration
const client = createWhatsappClient({});
const sent = await client.sendText(
  { tenantId, secrets },
  { phoneNumberId, to: "+491701234567", text: "Hello" },
);
// { ok: true, wamid } or { ok: false, code: "missing_credentials" | "invalid_recipient" | "rejected" | ... }
```

`sendText`, `sendTemplate`, `sendButtons` (payload freely chosen, returned in the button reply) and `sendMedia` (image by link) all take the sending `phoneNumberId`. Outside the 24-hour window Meta rejects free text with code 131047 (`WHATSAPP_OUTSIDE_WINDOW_ERROR_CODE`); use a template then. `sendTemplate` also takes `quickReplyPayloads` (1 to 10 payloads, one per quick-reply button of the template, which must be the template's first buttons since payload i goes to button index i; a tap returns the payload as `buttonPayload`) and `headerImageLink` (https URL for an image header). Tokens never appear in results, errors or logs.

`fetchMedia(ctx, mediaId)` asks the Graph API for the URL and mime type, then downloads the bytes. The URL from the Graph answer is checked against `allowedHosts` (default `graph.facebook.com` and `lookaside.fbsbx.com`) and https before the bearer token is sent.

## Consumers

A worker-run job triggered by `message-received` attaches the business process (answering, ticket creation). Which lane runs it is the consuming app's choice; the feature only emits the events.

## Testing

`createInMemoryMeta()` is a Meta stand-in for tests: pass its `transport` as the `transport` option, feed signed webhooks with `deliverMetaWebhook` and `requestMetaVerification` over the real HTTP stack, read every send from `meta.sent` and serve media with `meta.seedMedia`. The production path has no test code; the transport is an app option. See `packages/bundled-features/src/channel-whatsapp/__tests__/whatsapp.integration.test.ts` for a complete stack.
