---
status: reference
verified: 2026-10-26
evidence: "packages/bundled-features/src/subscription-paddle/feature.ts, constants.ts, plan-switch-methods.ts; packages/server-runtime/src/boot-options/billing-option.ts; packages/bundled-features/src/billing-foundation/types.ts, events.ts, one-off-checkout-gate.ts, plan-catalog.ts; packages/bundled-features/src/cap-overview/types.ts, handlers/caps-usage.query.ts; samples/apps/use-all-bundled/e2e-billing-docs/billing-docs.screenshots.spec.ts"
---

# Billing: plans, Paddle, one-off packs and the plan switch

`billing-foundation` shows the plan cards, starts checkouts and turns provider webhooks into tier state. The provider plugins are `subscription-stripe`, `subscription-mollie` and `subscription-paddle`. This guide covers the parts added in October 2026: Paddle as merchant of record, one-off packs, the gross plan switch preview and the plan card note. Consent and cancellation are in [Billing consumer protection](billing-consumer-protection.md).

## Paddle

Paddle replaces Dodo Payments: `subscription-dodo` is removed in the first release after 0.393.0. Paddle sells to the customer in its own name and issues the invoice and the VAT. Mount it through the boot option:

```ts illustration
await runProdApp({
  billing: {
    paddle: {
      priceToTier: { [env.PADDLE_PRICE_PRO]: "pro", [env.PADDLE_PRICE_TEAM]: "team" },
      oneOffPriceIds: [env.PADDLE_PRICE_CREDITS_100],
    },
  },
});
```

`paddleEnvSchema({ prices: ["PRO", "TEAM", "CREDITS_100"] })` declares one `PADDLE_PRICE_<NAME>` slot per price; each must start with `pri_`.

| Setting | Where |
|---|---|
| API key, webhook secret, tenant binding key, client token | system config keys backed by the secrets store; `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_TENANT_BINDING_KEY` and `PADDLE_CLIENT_TOKEN` are bridge fallbacks |
| `environment` | `sandbox` or `live`; Paddle serves them from different API hosts |
| `billingLive` | master switch; without it a checkout fails with `feature_disabled` |
| Webhook URL | `/webhooks/subscription/paddle` |
| Default Payment Link (Paddle dashboard) | `<APP_BASE_URL>/billing/paddle-checkout`; the feature serves this page itself |

All of them are runtime config, so keys rotate and production goes live without a redeploy. Paddle.js can send any `customData` from the browser, so a webhook counts only with a valid `tenantBinding` (an HMAC of the tenant id under the binding key). Rotating the binding key breaks the webhooks of existing subscriptions until they are bound again.

Coming from Dodo: replace `createSubscriptionDodoFeature` with `createSubscriptionPaddleFeature` (or `billing.dodo` with `billing.paddle`), the `DODO_PAYMENTS_*` env vars with the Paddle ones, and create the prices again in the Paddle catalog. Subscription prices need quantity minimum and maximum 1. Existing Dodo subscriptions are not migrated; a subscription stays with the provider stored on it.

## Plan cards

![Plan cards Free, Starter at 9 euros and Pro at 19 euros per month, each with the note plus VAT, and an Enterprise contact card](/screenshots/billing/plan-cards-price-note.png)

`catalog.priceNoteKey` puts a small note under every price. Use it when the catalog prices are net:

```ts illustration
createBillingFoundationFeature({
  baseUrl,
  catalog: {
    successPath: "/billing?checkout=success",
    cancelPath: "/billing",
    priceNoteKey: "billing-app:plan.price-note", // { en: "plus VAT", de: "zzgl. USt." }
    contact: enterpriseContactCard,
  },
});
```

The key belongs to the app's i18n. Without it the cards show no note.

## Plan switch with gross amounts

With Paddle the switch happens in the app. Before the customer confirms, `plan-switch-preview` asks Paddle for the proration:

![Confirm plan switch dialog: due now 6.67 euros including 1.06 euros VAT, credit 3.33 euros, new recurring price 23.68 euros per month including 3.78 euros VAT](/screenshots/billing/plan-switch-gross.png)

The dialog shows the amount due now with its tax, the credit for the unused time and the new recurring price as Paddle will charge it, tax included. The preview carries `amountDueNow`, `tax`, `credit`, `recurringAmount` and `recurringTax`, all in the smallest currency unit; a provider without a tax figure reports `null` and the dialog leaves the tax part out. The switch becomes active when Paddle's `subscription.updated` webhook arrives.

## One-off packs

A one-off checkout (mode `payment`) is open only for prices in the provider's `oneOffPriceIds`; an empty list closes them all. Without a further gate every listed price is open to any TenantAdmin. `authorizeOneOffCheckout` adds the app's own rule, for example "credit packs only on a paid plan":

```ts illustration
createBillingFoundationFeature({
  baseUrl,
  authorizeOneOffCheckout: async (ctx, { tenantId, priceId }) => {
    const tier = await readTier(ctx, tenantId);
    if (tier === "free") {
      return { allowed: false, reason: "pack_needs_paid_plan", i18nKey: "billing-app:errors.packNeedsPaidPlan" };
    }
    return { allowed: true };
  },
});
```

It runs after the `oneOffPriceIds` check and before any provider call. A rejection becomes a 422 with `reason` as the error code and `i18nKey` as the message.

A paid pack arrives as `payment-received` (`PAYMENT_RECEIVED_EVENT_QN`) with `priceId` and `quantity`. Multiply the credits by `quantity`; an absent value means 1. Set the quantity limits of pack prices in Paddle on purpose. The pack size can live in Paddle too: `custom_data.credits` on the price or product arrives as `ProviderPrice.metadata.credits`.

```ts illustration
r.job({
  name: "credits:grant",
  trigger: { on: PAYMENT_RECEIVED_EVENT_QN },
  handler: async (payload, ctx) => {
    const credits = CREDITS_PER_PRICE[payload.priceId] * (payload.quantity ?? 1);
    await grantCredits(ctx, credits);
  },
});
```

## Caps without a limit

`cap-overview` shows a card per cap with usage, limit and a progress bar. For a cap whose limit should stay private, or a pure usage meter, set `showLimit: false`:

![Plans and caps: Notes 12 of 10, Tags 4 of 5, Seats 2 of 5, and API calls and Templates with a plain counter](/screenshots/billing/cap-overview-show-limit.png)

```ts illustration
{ id: "templates", label: "app:caps.templates", usage: countTemplates, limit: () => null, showLimit: false }
```

The card then shows the counter only. The limit is not sent to the client at all; enforcement stays with `cap-counter`. To show selected caps on a dashboard, use the cap cards panel with `capKeys`; see the screen layout reference.
