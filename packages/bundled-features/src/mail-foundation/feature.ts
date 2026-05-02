// kumiko-feature-version: 1
//
// mail-foundation as a Kumiko bundled feature.
//
// **Was diese Feature liefert:**
//   1. **Plugin-API** für Mail-Transport-Provider via `r.extendsRegistrar
//      ("mailTransport", ...)`. Provider-Features (mail-transport-smtp,
//      mail-transport-brevo-api, ...) registrieren sich namentlich.
//   2. **Tenant-Config-key** `provider`: select-Wert der zur Runtime
//      bestimmt welcher registrierte Plugin verwendet wird.
//   3. **createTransportForTenant(ctx, tenantId)** Factory die den
//      gewählten Plugin im Registry sucht und seine `build`-Methode
//      aufruft.
//
// **Was diese Foundation NICHT mehr macht (im Vergleich zur ersten
// Iteration):**
//   - Keine SMTP/Brevo/Postmark-spezifischen Config-Keys mehr in
//     mail-foundation. Provider-spezifische Config (host/port/from/
//     authUser für SMTP, apiUrl/accountId für Brevo etc.) lebt im
//     jeweiligen Provider-Plugin-Feature.
//   - Kein direkter Import von `createSmtpTransport`. Die Foundation
//     kennt nur das `EmailTransport`-Interface (Type-Import, kein
//     runtime-coupling), nicht die konkrete Implementation.
//
// **Pattern-Vorbild:** identisch zu `delivery` + `channel-email`. Die
// delivery-feature deklariert `r.extendsRegistrar("deliveryChannel")`,
// channel-email registriert sich via `r.useExtension("deliveryChannel",
// "email", {...})`. Selbe Trennung Foundation ↔ Provider.
//
// **Standalone:** Foundation ist ohne tier-engine nutzbar. Existing
// `channel-email` (App-wide-Mail-Sender via delivery) bleibt unangetastet
// — additive Feature.

import type { EmailTransport } from "@kumiko/bundled-features/channel-email";
import { requireDefined } from "@kumiko/bundled-features/foundation-shared";
import {
  access,
  createTenantConfig,
  defineFeature,
  type HandlerContext,
} from "@kumiko/framework/engine";

const FEATURE_NAME = "mail-foundation";

// =============================================================================
// Plugin-Interface — what a Provider-Plugin must implement
// =============================================================================

/**
 * Mail-Transport-Plugin contract. Each provider-feature (mail-transport-
 * smtp, mail-transport-brevo-api, ...) registers an implementation via
 * `r.useExtension("mailTransport", "<name>", { build })`.
 *
 * `build(ctx, tenantId)` reads the plugin's own config-keys + secrets
 * (the plugin owns its provider-specific config schema) and constructs
 * an EmailTransport. Per-call construction so a tenant editing config
 * sees the change on the next mail.
 */
export type MailTransportPlugin = {
  readonly build: (ctx: HandlerContext, tenantId: string) => Promise<EmailTransport>;
};

// =============================================================================
// Feature-definition
// =============================================================================

export const mailFoundationFeature = defineFeature(FEATURE_NAME, (r) => {
  r.requires("config");

  // Plugin extension-point. Provider-features register here. The
  // entityName at registration time becomes the value tenants pick in
  // `provider` config-key (e.g. "smtp", "brevo-api").
  r.extendsRegistrar("mailTransport", {
    onRegister: () => {
      // No side-effects at register-time — the registry stores the
      // usage, factory looks it up at request-time. Same shape as
      // delivery's extendsRegistrar.
    },
  });

  const configKeys = r.config({
    keys: {
      // Provider-selector. Default empty so the boot-validator throws
      // if a tenant tries to send mail without first picking + setting
      // up a provider — better than a silent fallback.
      // The actual list of valid values lives in the registered plugins,
      // not here — Designer-UI can render `getExtensionUsages
      // ("mailTransport").map(u => u.entityName)` as the option-list.
      provider: createTenantConfig("text", {
        default: "",
        write: access.roles("TenantAdmin", "SystemAdmin"),
        read: access.roles("TenantAdmin", "SystemAdmin", "User"),
      }),
    },
  });

  return {
    /** Config-key-handle for the provider-selector. */
    configKeys,
  };
});

// =============================================================================
// Transport-factory — looks up the registered plugin + delegates
// =============================================================================

/**
 * Resolves the tenant's mail-transport. Reads the `provider` config-key,
 * looks up the matching plugin in the registry, calls its `build(ctx,
 * tenantId)`-method.
 *
 * **Caller pattern:**
 *   const transport = await createTransportForTenant(ctx, event.user.tenantId);
 *   await transport.send({ to, subject, html });
 */
export async function createTransportForTenant(
  ctx: HandlerContext,
  tenantId: string,
  handlerName = "mail-foundation:transport-factory",
): Promise<EmailTransport> {
  const ctxConfig = ctx.config;
  if (!ctxConfig) {
    throw new Error(
      `${handlerName}: ctx.config is missing — feature requires the config-feature mounted in the registry`,
    );
  }
  if (!ctx.registry) {
    throw new Error(
      `${handlerName}: ctx.registry is missing — required to look up registered mail-transport plugins`,
    );
  }

  const provider = requireDefined(
    await ctxConfig(mailFoundationFeature.exports.configKeys.provider),
    FEATURE_NAME,
    "provider",
  ) as string;
  if (provider.length === 0) {
    const usages = ctx.registry.getExtensionUsages("mailTransport");
    const known = usages.map((u) => u.entityName).join(", ") || "<none>";
    throw new Error(
      `${FEATURE_NAME}: no provider selected — set the 'provider' config-key to one of: ${known}. ` +
        `Mount a mail-transport-* feature first if no plugins are registered.`,
    );
  }

  const usages = ctx.registry.getExtensionUsages("mailTransport");
  const usage = usages.find((u) => u.entityName === provider);
  if (!usage) {
    const known = usages.map((u) => u.entityName).join(", ") || "<none>";
    throw new Error(
      `${FEATURE_NAME}: provider "${provider}" not registered. Known: ${known}. ` +
        `Mount the matching mail-transport-${provider} feature.`,
    );
  }

  // @cast-boundary engine-payload — extension-usage carries unknown options
  const plugin = usage.options as MailTransportPlugin;
  return plugin.build(ctx, tenantId);
}
