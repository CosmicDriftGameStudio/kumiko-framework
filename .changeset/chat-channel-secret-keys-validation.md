---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

`r.secret` and `r.secretNamespace` accept a `valueSchema`. `secrets:write:set` checks the value against it after the key and role checks and answers a failure with a 400 validation error on field `value` (`secrets.errors.invalidValue`); the response never contains the value or the schema's issues. `secrets:write:delete` is unaffected.

The chat channels use it: Slack, Discord and Teams webhook secrets must be URLs that pass the channel's host allowlist (including the Discord `/api/webhooks/` path), and the Telegram bot token must have the `<bot id>:<secret>` shape. The allowlist comes from the same options as the channel, so `createChannelSlackFeature({ allowedHosts })` also governs what can be stored.

`channel-slack`, `channel-discord`, `channel-teams` and `channel-telegram` now export their secret keys (`SLACK_SECRET_KEYS`, `DISCORD_SECRET_KEYS`, `TEAMS_SECRET_KEYS`, `TELEGRAM_SECRET_KEYS`), allowlist constants and `isTelegramChatId` / `isTelegramBotToken`. `delivery` exports `checkChatWebhookTarget`, `chatWebhookUrlSchema` and `resolveChatWebhookTarget`, so apps can validate an address or URL when a user creates a channel.

Existing invalid secrets stay stored; only new writes are checked. Writes through `ctx.secrets.set` in feature code are not checked.

<!-- kumiko-changes
feature: secrets
type: improvement
title: Chat channel secret values are validated on write
-->
