---
status: reference
verified: 2026-10-04
evidence: "kumiko-framework#3467 (chat channels), #3546 (error codes, Teams response check), 0600763b2 (Telegram host allowlist); packages/bundled-features/src/channel-{slack,discord,teams,telegram}; packages/bundled-features/src/delivery/chat-webhook-channel.ts"
---

# Delivery chat channels: Slack, Discord, Teams, Telegram

Four bundled features register a chat channel in the `delivery` system. Each is mounted by the app and addressed per notification through `route`. They are tenant-owned targets: the tenant stores the webhook URL or bot token as a secret, and nothing is reachable through recipient lookup.

| Feature | Factory | Route address | Secret |
|---|---|---|---|
| `channel-slack` | `createChannelSlackFeature(opts?)` | connection name | `channel-slack:webhooks.<connection>` (webhook URL) |
| `channel-discord` | `createChannelDiscordFeature(opts?)` | connection name | `channel-discord:webhooks.<connection>` (webhook URL) |
| `channel-teams` | `createChannelTeamsFeature(opts?)` | connection name | `channel-teams:webhooks.<connection>` (webhook URL) |
| `channel-telegram` | `createChannelTelegramFeature(opts?)` | chat id or `@channel` | `channel-telegram:secret:bot-token` (one token per tenant) |

Import from `@cosmicdrift/kumiko-bundled-features/channel-slack` and so on. Each feature requires `delivery` and `secrets`.

```ts illustration
await ctx.notify("ops.deploy-finished", {
  route: { slack: "ops-alerts", telegram: "@deploy_log" },
});
```

A connection name is 1 to 64 characters of `a-z`, `0-9` and `-`, starting with a letter or digit. An address that fails the check ends as `invalid_address` without reading a secret.

## Message shape

Every channel sends the notification title, then the body on a new line.

- Slack: `{ text }` with `&`, `<` and `>` escaped, so `<!channel>` mentions stay inert.
- Discord: `{ content, allowed_mentions: { parse: [] } }`, cut to 2000 characters. `@everyone`, `@here` and user or role mentions do not ping.
- Teams: an Adaptive Card with the title in a bold `TextBlock` and the body in a second one.
- Telegram: `sendMessage` as plain text, cut to 4096 characters.

## App options and safety

The options are app code and never tenant config.

- `allowedHosts` replaces the provider default (`hooks.slack.com`; `discord.com` and `discordapp.com` with the path prefix `/api/webhooks/`; `.webhook.office.com`, `.logic.azure.com` and `.powerplatform.com` for Teams, a leading dot meaning a suffix; `api.telegram.org`).
- `requireHttps` defaults to `true`. `false` is for local test servers and switches to an internal egress policy that only allows the listed host.
- `timeoutMs` defaults to 10 seconds.
- Telegram also takes `apiBaseUrl` for a self-hosted Bot API server. Its host must be in `allowedHosts`, and it must be https unless `requireHttps: false`. Boot fails otherwise.

A webhook URL is checked against the allowlist when the secret is written (see `docs/reference/secret-keys.md`), and again when it is used. Requests go through the external egress policy, which also refuses private and reserved address ranges. A redirect to another host ends as `redirect_blocked`.

## Results

Failures are stored as fixed codes, never as the provider's text: `timeout`, `network_error`, `redirect_blocked`, `host_not_allowed`, `missing_credentials`, `invalid_address`, `unexpected_response` or `http_<status>`. Webhook URLs and tokens never reach logs or delivery attempts; only the connection name is logged.

Teams answers a classic connector with 200 and the body `1`, which counts as sent. A workflow endpoint answers 202 and does not say whether the card arrived, so the attempt is `sent` with `confirmed: false`. Any other 2xx (an empty 200 is what a made-up URL returns) is `unexpected_response`.

The secret keys are exported as `SLACK_SECRET_KEYS`, `DISCORD_SECRET_KEYS`, `TEAMS_SECRET_KEYS` and `TELEGRAM_SECRET_KEYS`. For a custom chat provider, `createChatWebhookChannel`, `chatWebhookUrlSchema` and `resolveChatWebhookTarget` come from `delivery`.
