# Cap-Billing Demo

Sample app showing how a Kumiko app wires **tier-engine** + **cap-counter** + **mail-foundation plugin API** together to enforce per-tenant caps on newsletter sends — including a soft-hit notification and a hard block.

The sample doubles as **living documentation** for the pattern: read the code top-to-bottom and you've understood the cap engine.

## What the demo does

A tiny newsletter app with two tiers:

| Tier | Newsletters per month | Soft warning at | Hard block at |
|------|-----------|-------------------|-----------------|
| free | 10 | 11 (110%) | 12 (120%) |
| pro | 100 | 110 (110%) | 120 (120%) |

Mails land in an **in-memory transport** (`mail-transport-inmemory`).
There's no real SMTP server — perfect for the demo, no Mailpit/Mailcrab
needed. The inbox is read via a helper function.

## Architecture in 4 layers

```
┌──────────────────────────────────────────────────────────────┐
│ src/feature.ts                                               │
│   newsletter:write:send (cap-aware)                          │
│   ├── inner handler: createTransportForTenant + .send()      │
│   └── wrapper: withCapEnforcement                            │
│       ├── pre: enforceCapAndMaybeNotify (tier-conditional)   │
│       │     └── notifier: sends warning mail to admin        │
│       └── post: incrementCap (+1)                            │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ src/tier-map.ts                                              │
│   DEMO_TIER_MAP: Record<TierName, {features, caps}>          │
│   resolveTier(ctx) → 1. subscription row (provider webhook)  │
│                      2. config "newsletter:config:tier"      │
│                      3. default "free"                       │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ src/run-config.ts                                            │
│   APP_FEATURES = [secrets, cap-counter, mail-foundation,     │
│                   mail-transport-inmemory,                   │
│                   billing-foundation, newsletter]            │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ bundled-features (no code in the app)                        │
│   tier-engine: composeApp + TierMap type                     │
│   cap-counter: enforceCap + withCapEnforcement + counter ES  │
│   mail-foundation: plugin API for transports                 │
│   mail-transport-inmemory: per-tenant in-memory inbox        │
│   billing-foundation: provider plugin host (Stripe/          │
│                            Mollie). Demo mounts no           │
│                            providers — tests call process-   │
│                            event directly; your own app adds │
│                            createSubscriptionStripeFeature() │
└──────────────────────────────────────────────────────────────┘
```

## Demo story as a test

The most thorough doc for the demo is the integration test itself:

```bash
bun test
```

`src/__tests__/cap-billing-demo.integration.ts` boots the full
dispatcher + DB and proves step by step:

- 10 newsletters sent without warning
- 12th newsletter triggers the soft-hit notification once
- 13th newsletter is hard-blocked (CapExceededError)
- Pro tenant unaffected by the free tenant's cap
- **Mid-period tier change:** free→pro upgrade keeps the counter
  intact + immediately uses the higher cap (= the real Stripe-webhook
  path). pro→free downgrade blocks immediately when the counter is
  above the new hard limit.

Read the test file top-to-bottom — it's written as a living doc.

## Run locally

```bash
bun kumiko dev      # Postgres + Redis
bun install
cd samples/apps/cap-billing-demo
bun dev             # → http://localhost:4290
```

| Login | Value |
|-------|------|
| URL | `http://localhost:4290` |
| Email | `admin@cap-demo.local` |
| Password | `changeme` |
| Tenant | "Cap-Billing-Demo" |

In the browser, use the Designer/Admin UI to set the config key
`newsletter:config:tier` to `"free"` or `"pro"` and trigger the
`newsletter:write:send` handler. The "sent" mails land in
`getInbox(tenantId)` from
`@cosmicdrift/kumiko-bundled-features/mail-transport-inmemory` —
there's no HTTP endpoint for it because the sample shows the
architecture, not an inbox UI.

If you want clickable: write a small `r.queryHandler("inbox:list")`
that returns `getInbox(ctx.user.tenantId)`. ~20 LOC, deliberately
omitted to keep the focus on cap+tier.

## How do I port this to a real app?

The sample is intentionally minimal. For a production app, swap:

| Demo component | Production replacement |
|-----------------|-------------------|
| `mail-transport-inmemory` | `mail-transport-smtp` (BYOK) or a custom plugin |
| Hardcoded `DEMO_TIER_MAP` | stays — tier definitions are static, the subscription row only writes the `tier` key |
| Tier switch via webhook (test-only) | mount a real plugin: `createSubscriptionStripeFeature(...)` and/or `createSubscriptionMollieFeature(...)` in the run config |
| 2 tiers (free/pro) | any number, see `samples/apps/platform/src/tier-map.ts` for a 4-tier example |
| Newsletter domain | your own feature with `withCapEnforcement(handler, capResolver)` |

The **plugin API switch** between demo and production is a single
config value: `mail-foundation:config:provider` flips from
`"inmemory"` to `"smtp"`, no code refactor.

## Key files

- **`src/feature.ts`** — the wrapped send handler. Here you see how
  `withCapEnforcement` turns a normal handler into a cap-aware one
- **`src/tier-map.ts`** — DEMO_TIER_MAP + tier-name whitelist
- **`src/run-config.ts`** — feature composition (which bundled-features
  the demo mounts)
- **`src/__tests__/cap-billing-demo.integration.ts`** — the played-out
  story (10/11/12/13 newsletters, soft+hard transitions, tenant
  isolation)

## Questions / weaknesses this demo exposes

The sample is meant as a doc test. Concrete weaknesses we see here:

- **Notifier address hardcoded.** `buildSoftHitNotifier` in
  `feature.ts` sends to `admin@tenant-${id.slice(-4)}.demo`. A real
  app would query tenant config or the users table.
- **Tier lookup per send call.** `resolveTier(ctx)` runs a DB query on
  the subscription row on every send — for busy tenants caching would
  be sensible. The demo skips it because it distracts from the cap
  pattern.
- **No provider mount in the demo itself.** The tests call
  `billing-foundation:write:process-event` directly; in production an
  app mounts `createSubscriptionStripeFeature(...)` or
  `createSubscriptionMollieFeature(...)` and Mollie/Stripe webhooks
  hit `/api/subscription/webhook/:providerName`.
