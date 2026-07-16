// Encrypted per-tenant config — Stripe-API-key pattern.
//
// Minimal-Showcase: ein dummy "billing"-feature mit einem per-tenant
// Stripe-API-Key. Der `mask`-Eintrag lässt den configEdit-Screen +
// Settings-Hub-Nav automatisch entstehen (kein handgeschriebenes
// r.screen/r.nav mehr). charge-handler liest den Key über ctx.config
// (entschlüsselt automatisch).
//
// Production: nicht aufrufen — der echte Stripe-Call ist hier ein Mock.
// Pattern in produktiven Apps: Strip-API-Key in tenantBillingConfig.key,
// charge-handler lädt key + ruft tatsächlich Stripe.

import {
  access,
  type ConfigKeyDefinition,
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

const billingConfigKeyMap: Record<string, ConfigKeyDefinition> = {
  "stripe-api-key": stripeApiKeyDef,
};

// Charge-Handler — nutzt den entschlüsselten API-Key. Caller sieht NUR
// die charge-id zurück, der Key bleibt server-side.
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

    // Mock: real impl würde fetch("https://api.stripe.com/v1/charges",
    // { headers: { Authorization: `Bearer ${apiKey}` }, ... }) ausführen.
    // Wichtig: apiKey verlässt den server NICHT — kein log, kein
    // response-field, kein error-detail.
    const chargeId = `ch_${Date.now()}_${event.payload.customerRef}`;

    return {
      isSuccess: true as const,
      data: { chargeId },
    };
  },
});

export const billingFeature = defineFeature(FEATURE, (r) => {
  r.requires("config");
  r.config({ keys: billingConfigKeyMap });
  r.writeHandler(chargeHandler);
  // Kein r.screen/r.nav: der `mask`-Eintrag auf dem Key lässt
  // buildConfigFeatureSchema den configEdit-Screen (••••••-maskiert,
  // config:write:set verschlüsselt vor dem write) + den Settings-Hub-Nav
  // automatisch ableiten.
});

// Re-exports damit tests die handles ohne re-typing nutzen können.
export { stripeApiKeyHandle };
