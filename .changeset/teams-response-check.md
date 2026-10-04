---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-framework": minor
---

`channel-teams` no longer reports every 2xx answer as sent. A 200 with the body `1` (classic Office connector) is a confirmed send. A 202 (Power Automate / Workflows endpoints) means the message was accepted but not confirmed: the attempt is `sent` and `NotifyResult.deliveries[].confirmed` is `false`. Any other 2xx, including an empty 200 as a made-up URL returns, fails with `unexpected_response`.

`NotifyDelivery.confirmed` and `ChannelResult.confirmed` are new and only ever `false`. `createChatWebhookChannel` takes an optional `classifyResponse`, which `postChatWebhook` calls for 2xx answers with a status and a lazy `readBodyPrefix()` (at most 64 bytes; the body is always cancelled afterwards). `ChatSendResult` success now carries `confirmed`. `confirmed` is returned for inline delivery only; jobs do not carry it yet.

<!-- kumiko-changes
feature: channel-teams
type: bugfix
title: Teams no longer reports any 2xx as delivered
-->
