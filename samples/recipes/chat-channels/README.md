# Sample: Chat Channels

Shows how a feature posts to a tenant's Slack channel without ever handling the webhook URL.

## What you learn here

**Route-only targets:** Chat targets belong to the tenant, not to a user. A handler addresses one with `ctx.notify(type, { route: { slack: "ops" } })`; `"ops"` is a connection name. The chat channels declare no `resolve`, so a normal `to: userId` notification skips them without a log row.

**Secrets for the URL:** The tenant stores the webhook URL as a secret under `channel-slack:webhooks.<connection name>` (namespace declared by the channel, written through `secrets:write:set`). The `delivery.send` job reads it with an audit entry (`channel-slack:send`), posts the message and records only the connection name and an outcome code (`http_500`, `timeout`, `redirect_blocked`, `host_not_allowed`, `missing_credentials`, `invalid_address`).

**App-level hardening:** Each channel only talks to its provider's hosts, over https, without following redirects. `allowedHosts`, `requireHttps` and `timeoutMs` are options of `createChannelSlackFeature(opts)`. Tenants cannot change them; the test uses them to point at a local stub.

**Production boot:** `runProdApp`, `runDevApp` and `runWorkerApp` wire `ctx.notify` and the tenant secrets for you, so no app wiring is needed. Queued channels run through the `delivery.render`/`delivery.send` jobs on the worker lane (all-in-one by default); a "send test message" handler can pass `immediate: true` to `ctx.notify` to deliver inline and read `sent`/`failed` from the returned `deliveries`.

The same shape works for `channel-discord`, `channel-teams` (connection name + webhook secret) and `channel-telegram` (one `botToken` secret, the address is the chat id).

## Run

```bash
bun test --config=bunfig.integration.toml --timeout=15000 samples/recipes/chat-channels
```
