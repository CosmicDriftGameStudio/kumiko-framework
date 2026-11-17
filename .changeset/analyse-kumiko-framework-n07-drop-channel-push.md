---
"@cosmicdrift/kumiko-bundled-features": minor
---

The `channel-push` feature and its subpath `@cosmicdrift/kumiko-bundled-features/channel-push` are removed.

<!-- kumiko-changes
feature: delivery
type: breaking
title: channel-push removed
detail: `channel-push` shipped no real transport, only an in-memory one, and no app used it. Removed with the subpath `@cosmicdrift/kumiko-bundled-features/channel-push`: `createChannelPushFeature`, `createPushChannel`, `createInMemoryPushTransport`, `PushChannelOptions`, `PushMessage` and `PushTransport`. The delivery service, its queued channel mode and the `push` key of notification templates are unchanged.
migration: An app that needs push registers its own channel: `r.useExtension(DELIVERY_CHANNEL_EXTENSION, "push", { mode: "queued", resolve, send })` with `resolve` mapping a user id to a device token and `send` calling the push provider.
-->
