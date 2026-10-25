// Encrypted per-tenant config — Stripe API key pattern.
//
// Minimal showcase: a dummy "billing" feature with a per-tenant
// Stripe API key. The `mask` entry makes the configEdit screen +
// settings hub nav appear automatically (no more hand-written
// r.screen/r.nav). The charge handler reads the key via ctx.config
// (decrypted automatically).
//
// Production: do not call — the real Stripe call is a mock here.
// Pattern in productive apps: Stripe API key in tenantBillingConfig.key,
// the charge handler loads the key + actually calls Stripe.

import {
  access,
  type ConfigKeyHandle,
  createTenantConfig,
  defineFeature,
  defineWriteHandler,
} from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";

const FEATURE = "billing";

// Config-Key-Definition: encrypted=true → ciphertext in der DB. write/
// read: access.admin damit nur Tenant-Admin den Key setzt + reads sind
// nur backend-side via ctx.config (frontend sieht "••••••"). `mask` →
// buildConfigFeatureSchema derivt Screen + Settings-Hub-Nav.
const stripeApiKeyDef = createTenantConfig("text", {
  encrypted: true,
  write: access.admin,
  read: access.admin,
  // mask-derived screens carry no field constraints (maxLength, pattern) —
  // set those separately in a configEdit schema if you need them enforced.
  mask: { title: "billing.stripe-api-key", order: 1 },
});

const stripeApiKeyHandle: ConfigKeyHandle<"text"> = {
  name: `${FEATURE}:config:stripe-api-key`,
  type: "text",
};

// Charge handler — uses the decrypted API key. The caller sees ONLY
// the charge id back, the key stays server-side.
const chargeHandler = defineWriteHandler({
  name: "charge",
  schema: z.object({
    amount: z.number().positive(),
    customerRef: z.string().min(1),
  }),
  access: { roles: ["Admin"] },
  async handler(event, ctx) {
    if (!ctx.config) {
      return writeFailure(
        new UnprocessableError("config_unavailable", {
          i18nKey: "billing.errors.configUnavailable",
        }),
      );
    }
    const apiKey = await ctx.config(stripeApiKeyHandle);
    if (!apiKey || apiKey.length === 0) {
      return writeFailure(
        new UnprocessableError("stripe_key_missing", {
          i18nKey: "billing.errors.stripeKeyMissing",
        }),
      );
    }

    // Mock: a real impl would execute fetch("https://api.stripe.com/v1/charges",
    // { headers: { Authorization: `Bearer ${apiKey}` }, ... }).
    // Important: apiKey does NOT leave the server — no log, no
    // response field, no error detail.
    const chargeId = `ch_${Date.now()}_${event.payload.customerRef}`;

    return {
      isSuccess: true as const,
      data: { chargeId },
    };
  },
});

export const billingFeature = defineFeature(FEATURE, (r) => {
  r.requires({ features: ["config"] });
  r.config("stripe-api-key", stripeApiKeyDef);
  r.writeHandler(chargeHandler);
  // No r.screen/r.nav: the `mask` entry on the key lets
  // buildConfigFeatureSchema derive the configEdit screen (••••••-masked,
  // config:write:set encrypts before the write) + the settings hub nav
  // automatically.

  r.translations({
    keys: {
      "billing.settings": { de: "Abrechnung", en: "Billing" },
      "billing.stripe-api-key": { de: "Stripe-API-Schlüssel", en: "Stripe API Key" },
    },
  });
});

// Re-exports so tests can use the handles without re-typing.
export { stripeApiKeyHandle };
