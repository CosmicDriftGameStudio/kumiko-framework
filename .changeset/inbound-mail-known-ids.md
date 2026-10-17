---
"@cosmicdrift/kumiko-bundled-features": minor
---

Inbound mail fetch can skip already-seen message ids

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: Inbound mail fetch can skip already-seen message ids
detail: InboundMailProviderPlugin.fetch receives an optional filterUnknownMessageIds(providerMessageIds) hook. The watch supervisor implements it with a tenant- and account-scoped lookup of already-seen provider message ids and returns the ids not seen yet, so a plugin can avoid downloading messages it has already processed.
-->
