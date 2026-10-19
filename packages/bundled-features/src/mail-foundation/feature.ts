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
import { MAIL_FOUNDATION_I18N } from "./i18n.ts";

const FEATURE_NAME = "mail-foundation";

// Extension-point name for transport-provider plugins (mail-transport-smtp,
// mail-transport-brevo-api, ...).
export const MAIL_TRANSPORT_EXTENSION = "mailTransport" as const;

// =============================================================================
// Plugin-Interface — what a Provider-Plugin must implement
// =============================================================================

/**
 * Narrow surface type for transport plugins, mirroring file-foundation's
 * FileProviderContext. HandlerContext carries tx, actor, signal and more;
 * plugins only get the read fields needed for tenant config and secret lookup.
 *
 * **Why not the full HandlerContext?** On the worker path (transport builds
 * triggered by r.job, such as the user-data-rights forget/export cron) there
 * is no per-request `config`/`tx`/`actor`; the wrapper builds the per-tenant
 * ConfigAccessor from `ctx.configResolver`. A plugin reading `ctx.tx` or other
 * request-only fields would break the worker path at runtime, and that would
 * only show up with real SMTP in production. Casting
 * `ctx as unknown as HandlerContext` satisfies the compiler but fails at
 * runtime in the worker. A plugin that needs more extends MailTransportContext
 * explicitly (a visible breaking change) instead of casting ctx.
 *
 * **Fields:**
 *   config      — tenant config reads (the plugin's host/port/from/...)
 *   registry    — extension lookup in the factory (not plugin-internal)
 *   secrets     — tenant secret reads (smtp.password)
 *   auditUserId — audit identity for secret reads. Handler path: the
 *                 dispatcher sets the caller's user id; worker path: the
 *                 r.job wrap sets a system identity.
 */
export type MailTransportContext = {
  readonly config?: ConfigAccessor;
  readonly registry?: Registry;
  readonly secrets?: import("@cosmicdrift/kumiko-framework/secrets").SecretsContext;
  readonly auditUserId?: string | undefined;
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
  /** `false` keeps the provider out of the generated settings: it can still be set by a
   *  seed or config write, but a tenant admin is never offered it (e.g. a test inbox
   *  that swallows every mail). */
  readonly selectableInSettings?: false;
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
        "Defines the `mailTransport` extension point and a per-tenant `provider` config key that selects which registered transport plugin to use at runtime. Call `createTransportForTenant(ctx, tenantId)` to get an `EmailTransport` ready for sending \u2014 use this feature together with at least one `mail-transport-*` feature; use `delivery` + `channel-email` instead when you need the full notification pipeline with delivery attempts and user preferences. Pass `tenantMailTransport` as `tenantTransport` to `createChannelEmailFeature`: notifications declared with `tenantTransport: true` then go through the tenant's own transport when it has a provider and through the app transport otherwise. Tenant admins pick the provider and fill in its settings on the generated Email sending settings screen; an empty provider is a valid choice and means the platform sends.",
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

      // Empty = this tenant has no own provider: tenantMailTransport yields null and
      // channel-email uses the app transport, so empty is a valid choice a tenant can
      // return to (reset in the settings mask) and readiness must not flag it.
      // createTransportForTenant still throws on empty.
      const providerConfigKey = r.config(
        "provider",
        createTenantConfig("text", {
          default: "",
          // No SystemAdmin: a platform-level provider would be inherited by every tenant,
          // whose own credentials (tenant secrets) are missing, and break all their mail.
          write: access.withSystem(access.roles("TenantAdmin")),
          read: access.roles("TenantAdmin", "SystemAdmin", "User"),
          mask: {
            title: "mail-foundation.provider",
            description: "mail-foundation.provider.description",
            icon: "mail",
            order: 1,
          },
        }),
      );
      // Readiness gating: transport-plugins' required keys/secrets count only
      // while their plugin is the one this key selects.
      r.extensionSelector(MAIL_TRANSPORT_EXTENSION, providerConfigKey);

      r.translations({ keys: MAIL_FOUNDATION_I18N });

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
      auditUserId: createSystemUser(scope.tenantId).id,
    },
    scope.tenantId,
    "channel-email",
  );
}
