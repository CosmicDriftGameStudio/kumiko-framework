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

import {
  type EmailTransport,
  withPiiCiphertextGuard,
} from "@cosmicdrift/kumiko-bundled-features/channel-email";
import { requireDefined } from "@cosmicdrift/kumiko-bundled-features/foundation-shared";
import {
  access,
  type ConfigAccessor,
  createTenantConfig,
  defineFeature,
  type Registry,
} from "@cosmicdrift/kumiko-framework/engine";

const FEATURE_NAME = "mail-foundation";

// =============================================================================
// Plugin-Interface — what a Provider-Plugin must implement
// =============================================================================

/**
 * Schmaler Surface-Type fuer Transport-Plugins — gespiegelt von
 * file-foundation's FileProviderContext. HandlerContext ist zu fett
 * (haelt tx, actor, signal etc.); Plugins beschraenken sich auf die
 * read-Felder die fuer Tenant-Config + Secret-Lookup noetig sind.
 *
 * **Warum nicht voller HandlerContext?** Im Worker-Pfad (r.job-getriggerte
 * Transport-Builds, z.B. der user-data-rights forget/export-Cron) gibt es
 * keinen per-request `config`/`tx`/`actor` — der Wrapper baut den per-Tenant-
 * ConfigAccessor aus `ctx.configResolver`. Ein Plugin das `ctx.tx` oder
 * andere request-only-Felder liest, wuerde den Worker-Pfad zur Runtime
 * brechen — und das fiele NUR mit echtem SMTP und nur in production auf.
 * Cast `ctx as unknown as HandlerContext` macht den Compiler happy, fliegt
 * aber zur Runtime im Worker. Plugin das mehr braucht: MailTransportContext
 * explizit erweitern (sichtbarer breaking change) statt ctx-cast.
 *
 * **Felder:**
 *   config   — tenant-config-reads (host/port/from/... der Plugins)
 *   registry — extension-Lookup in der Factory (nicht plugin-intern)
 *   secrets  — tenant-secret-reads (smtp.password)
 *   _userId  — Audit-Identity fuer secret-reads. Handler-Pfad: dispatcher
 *              setzt Caller-User-ID; Worker-Pfad: r.job-Wrap setzt eine
 *              System-Identity.
 */
export type MailTransportContext = {
  readonly config?: ConfigAccessor;
  readonly registry?: Registry;
  readonly secrets?: import("@cosmicdrift/kumiko-framework/secrets").SecretsContext;
  readonly _userId?: string | undefined;
};

/**
 * Mail-Transport-Plugin contract. Each provider-feature (mail-transport-
 * smtp, mail-transport-brevo-api, ...) registers an implementation via
 * `r.useExtension("mailTransport", "<name>", { build })`.
 *
 * `build(ctx, tenantId)` reads the plugin's own config-keys + secrets
 * (the plugin owns its provider-specific config schema) and constructs
 * an EmailTransport. Per-call construction so a tenant editing config
 * sees the change on the next mail.
 *
 * **Plugin-Author-Warnung:** `ctx` ist EXPLIZIT ein MailTransportContext,
 * nicht ein voller HandlerContext (siehe MailTransportContext-Doc).
 */
export type MailTransportPlugin = {
  readonly build: (ctx: MailTransportContext, tenantId: string) => Promise<EmailTransport>;
};

// extension-usage `options` is engine-payload (unknown) — structurally validate
// instead of casting blind. Mirrors file-foundation's isFileProviderPlugin.
export function isMailTransportPlugin(o: unknown): o is MailTransportPlugin {
  return typeof o === "object" && o !== null && "build" in o && typeof o.build === "function";
}

// =============================================================================
// Feature-definition
// =============================================================================

export const mailFoundationFeature = defineFeature(FEATURE_NAME, (r) => {
  r.describe(
    "Defines the `mailTransport` extension point and a per-tenant `provider` config key that selects which registered transport plugin to use at runtime. Call `createTransportForTenant(ctx, tenantId)` to get an `EmailTransport` ready for sending \u2014 use this feature together with at least one `mail-transport-*` feature; use `delivery` + `channel-email` instead when you need the full notification pipeline with delivery attempts and user preferences.",
  );
  r.uiHints({
    displayLabel: "Mail Transport Foundation",
    category: "notifications",
    recommended: false,
  });
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

  // Provider-selector. Default empty so the boot-validator throws if a
  // tenant tries to send mail without first picking + setting up a
  // provider — better than a silent fallback. The actual list of valid
  // values lives in the registered plugins, not here — Designer-UI can
  // render `getExtensionUsages("mailTransport").map(u => u.entityName)`
  // as the option-list.
  const providerConfigKey = r.config(
    "provider",
    createTenantConfig("text", {
      default: "",
      // required: ohne gewählten Provider wirft createTransportForTenant —
      // readiness meldete vorher ready:true und der erste Mail-Send
      // lieferte den UnconfiguredError (280/1).
      required: true,
      write: access.roles("TenantAdmin", "SystemAdmin"),
      read: access.roles("TenantAdmin", "SystemAdmin", "User"),
    }),
  );
  // Readiness gating: transport-plugins' required keys/secrets count only
  // while their plugin is the one this key selects.
  r.extensionSelector("mailTransport", providerConfigKey);

  return {
    /** Config-key-handle for the provider-selector. */
    providerConfigKey,
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
  ctx: MailTransportContext,
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
    await ctxConfig(mailFoundationFeature.exports.providerConfigKey),
    FEATURE_NAME,
    "provider",
  ) as string; // @cast-boundary engine-payload
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

  if (!isMailTransportPlugin(usage.options)) {
    throw new Error(
      `${FEATURE_NAME}: provider "${provider}" registered without a build() — ` +
        `extension options must be a MailTransportPlugin.`,
    );
  }
  return withPiiCiphertextGuard(await usage.options.build(ctx, tenantId));
}
