---
"@cosmicdrift/kumiko-bundled-features": minor
---

Bundled extension points (renderer, deliveryChannel, mailTransport, inboundMailProvider, subscriptionProvider) are typed

<!-- kumiko-changes
feature: renderer-foundation
type: breaking
title: Bundled extension points (renderer, deliveryChannel, mailTransport, inboundMailProvider, subscriptionProvider) are typed
migration: |
  r.useExtension options for renderer ({ kinds, render }), deliveryChannel ({ mode, resolve, render?, send, accept? }), mailTransport (MailTransportPlugin), inboundMailProvider (InboundMailProviderPlugin) and subscriptionProvider (SubscriptionProviderPlugin) are now type-checked and required; renderer and deliveryChannel registrations do not pass name (it comes from the entity name). Prefer the new constants RENDERER_EXTENSION, DELIVERY_CHANNEL_EXTENSION and MAIL_TRANSPORT_EXTENSION over string literals. A registration whose options do not match the plugin shape now throws with the entity name when channels or renderers are collected.
-->
