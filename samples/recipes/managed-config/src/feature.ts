// Managed config — one declaration provisions everything a config key needs.
//
// Two keys, two backings, two scopes — same declarative surface:
//
//   payment-api-key  scope:"system"  backing:"secrets"   platform-owned secret
//     → stored envelope-encrypted in the secrets store (system tenant), masked
//       in every query, revealed only for the owning feature's ctx.config read.
//
//   smtp-host        scope:"tenant"  (config, plain)      per-tenant override
//     → platform default (env/system-row) that a tenant admin can override;
//       cascade resolves tenant-row → system-row → default.
//
// `mask` makes each key surface in the self-populating settings hub without a
// hand-written r.screen / r.nav. `env` wires the platform default from an
// environment variable at boot (runProdApp) — no manual AppConfigOverrides map.

import {
  access,
  type ConfigKeyHandle,
  createSystemConfig,
  createTenantConfig,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

const FEATURE = "integrations";

export const paymentApiKeyHandle: ConfigKeyHandle<"text"> = {
  name: `${FEATURE}:config:payment-api-key`,
  type: "text",
};

export const smtpHostHandle: ConfigKeyHandle<"text"> = {
  name: `${FEATURE}:config:smtp-host`,
  type: "text",
};

export const integrationsFeature = defineFeature(FEATURE, (r) => {
  r.requires("config");

  r.config({
    keys: {
      // System-only secret: backing:"secrets" routes storage to the secrets
      // envelope (KEK rotation + audit-on-read), never config_values. The
      // boot-guard rejects backing:"secrets" on any non-system scope.
      "payment-api-key": createSystemConfig("text", {
        backing: "secrets",
        write: access.systemAdmin,
        read: access.admin,
        mask: { title: "integrations.payment-api-key", icon: "credit-card", order: 1 },
      }),
      // Tenant override with a platform default. env seeds the default from
      // SMTP_HOST at boot; a tenant admin overrides it per tenant.
      "smtp-host": createTenantConfig("text", {
        env: "SMTP_HOST",
        default: "smtp.platform.example",
        write: access.roles("SystemAdmin", "Admin"),
        read: access.admin,
        mask: { title: "integrations.smtp-host", icon: "mail", order: 2 },
      }),
    },
  });

  // Internal-read probe: the owning feature reads its own secrets-backed key
  // via ctx.config and receives the revealed plaintext, never the mask.
  r.queryHandler(
    "peek-payment-key",
    z.object({}),
    async (_query, ctx) => {
      if (!ctx.config) throw new Error("ctx.config not wired");
      return { value: await ctx.config(paymentApiKeyHandle) };
    },
    { access: { roles: ["SystemAdmin"] } },
  );

  r.translations({
    keys: {
      "integrations.settings": { de: "Integrationen", en: "Integrations" },
      "integrations.payment-api-key": { de: "Zahlungs-API-Schlüssel", en: "Payment API Key" },
      "integrations.smtp-host": { de: "SMTP-Server", en: "SMTP Host" },
    },
  });
});
