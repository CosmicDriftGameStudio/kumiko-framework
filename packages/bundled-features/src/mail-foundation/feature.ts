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
  createSystemUser,
  createTenantConfig,
  defineFeature,
  type Registry,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";

const FEATURE_NAME = "mail-foundation";

// Extension-point name for transport-provider plugins (mail-transport-smtp,
// mail-transport-brevo-api, ...).
export const MAIL_TRANSPORT_EXTENSION = "mailTransport" as const;

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

// r.useExtension options-shape, co-located since the framework never imports upward.
declare module "@cosmicdrift/kumiko-framework/engine" {
  interface KumikoExtensionOptionsMap {
    [MAIL_TRANSPORT_EXTENSION]: MailTransportPlugin;
  }
}

// =============================================================================
// Feature-definition
// =============================================================================
export function createMailFoundationFeature() {
  return defineFeature(
    FEATURE_NAME,
    (r) => {
      r.describe(
        "Defines the `mailTransport` extension point and a per-tenant `provider` config key that selects which registered transport plugin to use at runtime. Call `createTransportForTenant(ctx, tenantId)` to get an `EmailTransport` ready for sending \u2014 use this feature together with at least one `mail-transport-*` feature; use `delivery` + `channel-email` instead when you need the full notification pipeline with delivery attempts and user preferences. Pass `tenantMailTransport` as `tenantTransport` to `createChannelEmailFeature` so a tenant with a provider configured sends delivery mails through its own transport and other tenants through the app transport.",
      );
      r.uiHints({
        displayLabel: "Mail Transport Foundation",
        category: "notifications",
        recommended: false,
      });
      r.requires({ features: ["config"] });

      // Plugin extension-point. Provider-features register here. The
      // entityName at registration time becomes the value tenants pick in
      // `provider` config-key (e.g. "smtp", "brevo-api").
      r.extendsRegistrar(MAIL_TRANSPORT_EXTENSION, {
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
          // required: without a chosen provider createTransportForTenant throws —
          // readiness used to report ready:true and the first mail send
          // surfaced the UnconfiguredError (280/1).
          required: true,
          write: access.roles("TenantAdmin", "SystemAdmin"),
          read: access.roles("TenantAdmin", "SystemAdmin", "User"),
        }),
      );
      // Readiness gating: transport-plugins' required keys/secrets count only
      // while their plugin is the one this key selects.
      r.extensionSelector(MAIL_TRANSPORT_EXTENSION, providerConfigKey);

      return {
        /** Config-key-handle for the provider-selector. */
        providerConfigKey,
      };
    },
    { dedupeOptions: {} },
  );
}

// The typed handles below come from one shared instance; each factory call builds its own handle objects.
const sharedMailFoundationFeature = createMailFoundationFeature();

/** @deprecated Use createMailFoundationFeature(). Run `bun kumiko-upgrade --apply`. Removed in the first release after 2026-10-29. */
export const mailFoundationFeature = sharedMailFoundationFeature;

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
  const transport = await createTransportForTenantIfConfigured(ctx, tenantId, handlerName);
  if (transport === null) {
    const usages = ctx.registry?.getExtensionUsages(MAIL_TRANSPORT_EXTENSION) ?? [];
    const known = usages.map((u) => u.entityName).join(", ") || "<none>";
    throw new Error(
      `${FEATURE_NAME}: no provider selected — set the 'provider' config-key to one of: ${known}. ` +
        `Mount a mail-transport-* feature first if no plugins are registered.`,
    );
  }
  return transport;
}

/**
 * Like createTransportForTenant, but an empty `provider` key means "this tenant has no
 * mail provider" and yields null. Every other problem (unknown provider, plugin build
 * failure) still throws, so a configured tenant never silently falls back.
 */
export async function createTransportForTenantIfConfigured(
  ctx: MailTransportContext,
  tenantId: string,
  handlerName = "mail-foundation:transport-factory",
): Promise<EmailTransport | null> {
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
    await ctxConfig(sharedMailFoundationFeature.exports.providerConfigKey),
    FEATURE_NAME,
    "provider",
  ) as string; // @cast-boundary engine-payload
  if (provider.length === 0) return null;

  const usages = ctx.registry.getExtensionUsages(MAIL_TRANSPORT_EXTENSION);
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

export type TenantMailTransportScope = {
  readonly tenantId: TenantId;
  readonly config?: ConfigAccessor | undefined;
  readonly registry: Registry;
  readonly secrets?: import("@cosmicdrift/kumiko-framework/secrets").SecretsContext | undefined;
};

/** The `tenantTransport` resolver for `createChannelEmailFeature`: the tenant's configured
 *  provider, or null so the channel falls back to its app transport. */
export function tenantMailTransport(
  scope: TenantMailTransportScope,
): Promise<EmailTransport | null> {
  return createTransportForTenantIfConfigured(
    {
      config: scope.config,
      registry: scope.registry,
      secrets: scope.secrets,
      _userId: createSystemUser(scope.tenantId).id,
    },
    scope.tenantId,
    "channel-email",
  );
}
