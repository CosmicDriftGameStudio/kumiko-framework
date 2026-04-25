// A miniature "billing" feature that reads a Stripe API key from ctx.secrets
// and simulates a charge. The point is to show how feature code uses the
// plaintext secret without ever exposing it to clients — the charge endpoint
// returns { chargeId } but never the apiKey.

import { requireSecretsContext } from "@kumiko/bundled-features/secrets";
import {
  defineFeature,
  defineWriteHandler,
  type FeatureDefinition,
  type SecretKeyHandle,
} from "@kumiko/framework/engine";
import { failUnprocessable } from "@kumiko/framework/errors";
import { z } from "zod";

// Typed handle exported by the feature's setup. Bound to what r.secret
// returns below — downstream code imports STRIPE_API_KEY.name for the
// qualified string, but never has to retype "billing:secret:stripe-api-key".
// Renaming the r.secret call updates every call-site through the import graph.
export let STRIPE_API_KEY: SecretKeyHandle;

const chargeWrite = defineWriteHandler({
  name: "charge",
  schema: z.object({
    amount: z.number().positive(),
    customerRef: z.string().min(1),
  }),
  access: { roles: ["TenantAdmin", "User"] },
  handler: async (event, ctx) => {
    const secrets = requireSecretsContext(ctx, "billing:write:charge");
    // requireSecretsContext returned a wrapper that auto-fills the audit
    // context (userId + "billing:write:charge") on every .get — the read
    // lands in tenant_secret_reads without the handler having to remember.
    const branded = await secrets.get(event.user.tenantId, STRIPE_API_KEY);
    if (!branded) {
      return failUnprocessable("stripe_key_missing", {
        hint: `TenantAdmin must first set ${STRIPE_API_KEY} via /api/write/secrets:write:set`,
      });
    }
    // reveal() is the explicit un-brand. Everything that comes out stays
    // plaintext string — we're now responsible for not letting it escape
    // into the response. Fingerprint is the deliberate, audited leak.
    const apiKey = branded.reveal();

    // Fake the external call — in real code this would be
    //   stripe = new Stripe(apiKey)
    //   await stripe.paymentIntents.create({...})
    // The key is consumed in-memory only; the response to the client never
    // mentions it.
    const chargeId = `ch_${Date.now()}_${event.payload.customerRef}`;
    const keyFingerprint = `${apiKey.slice(0, 5)}...${apiKey.slice(-4)}`;

    return {
      isSuccess: true,
      data: {
        chargeId,
        amount: event.payload.amount,
        // Include a harmless fingerprint so the test can assert the charge
        // used the correct key without revealing the full plaintext.
        keyFingerprint,
      },
    };
  },
});

export function createBillingFeature(): FeatureDefinition {
  return defineFeature("billing", (r) => {
    // Typed declaration of the secret this feature needs. Admin UIs can
    // list known secrets (label + hint) so tenant-admin doesn't have to
    // guess the key name; rotation / audit work by qualified name. The
    // handle's .name is the QN the registrar built for us.
    STRIPE_API_KEY = r.secret("stripe.apiKey", {
      label: { de: "Stripe API-Schlüssel", en: "Stripe API Key" },
      hint: {
        de: "Aus dem Stripe-Dashboard unter Developers → API Keys.",
        en: "From the Stripe dashboard under Developers → API Keys.",
      },
      // Domain-aware redaction: Stripe keys have a documented prefix+last4
      // shape, so show that instead of the generic first-3 policy.
      redact: (plaintext) => {
        if (plaintext.length < 10) return "•".repeat(plaintext.length);
        return `${plaintext.slice(0, 7)}...${plaintext.slice(-4)}`;
      },
      scope: "tenant",
    });
    r.writeHandler(chargeWrite);
  });
}
