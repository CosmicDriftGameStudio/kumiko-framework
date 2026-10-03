---
"@cosmicdrift/kumiko-bundled-features": minor
---

Four new delivery channels post to chat tools: `channel-slack`, `channel-discord`, `channel-teams` and `channel-telegram`. Chat targets belong to the tenant, so they are reached only through `route`, for example `ctx.notify(type, { route: { slack: "ops" } })`. The route address is a connection name for Slack, Discord and Teams (the webhook URL is a tenant secret under `channel-<provider>:webhooks.<connection name>`) and a chat id for Telegram (the bot token is the secret `channel-telegram:secret:bot-token`).

Sends use https only, a per-provider host allowlist, no redirects and a timeout. `delivery_attempts` records only the connection name and an outcome code such as `http_500`, `timeout`, `redirect_blocked` or `host_not_allowed`, never the URL or the token. `allowedHosts`, `requireHttps`, `apiBaseUrl` and `timeoutMs` are options of `createChannel<Provider>Feature(opts)`; tenants cannot set them.

`DeliveryChannel.resolve` is now optional. A channel without `resolve` is skipped for user notifications (`to`) without writing a `no_address` row. `ChannelContext` gains an optional `secrets`, which the `delivery.send` job fills from its job context.

<!-- kumiko-changes
feature: delivery
type: improvement
title: Slack, Discord, Microsoft Teams and Telegram delivery channels
detail: |
  `channel-slack`, `channel-discord`, `channel-teams` and `channel-telegram` register route-only delivery channels. Webhook URLs and the Telegram bot token live in the tenant's secrets; the send job reads them with an audit entry `<feature>:send`. `DeliveryChannel.resolve` is optional and `ChannelContext.secrets` is available on the send job path.
migration: |
  keine
-->
