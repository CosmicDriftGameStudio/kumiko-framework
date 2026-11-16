---
"@cosmicdrift/kumiko-bundled-features": minor
---

The WhatsApp Meta test double moved from `channel-whatsapp` to the `channel-whatsapp/testing` subpath.

<!-- kumiko-changes
feature: channel-whatsapp
type: breaking
title: WhatsApp test double moved to channel-whatsapp/testing
detail: `createInMemoryMeta`, `deliverMetaWebhook`, `requestMetaVerification`, `metaTextMessage`, `metaButtonReplyMessage`, `metaMediaMessage`, `metaStatus`, `metaWebhookPayload` and the `InMemoryMeta*` types are no longer exported from `@cosmicdrift/kumiko-bundled-features/channel-whatsapp`. They live in `@cosmicdrift/kumiko-bundled-features/channel-whatsapp/testing`, so the production entry point carries no test code. `signMetaBody` stays in the main entry.
migration: Change test imports of these names from `@cosmicdrift/kumiko-bundled-features/channel-whatsapp` to `@cosmicdrift/kumiko-bundled-features/channel-whatsapp/testing`. Production code is not affected.
-->
