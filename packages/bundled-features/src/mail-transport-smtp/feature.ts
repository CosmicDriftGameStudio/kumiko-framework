// kumiko-feature-version: 1
//
// mail-transport-smtp — concrete SMTP-implementation for the
// mail-foundation plugin-API.
//
// **Was diese Feature liefert:**
//   1. Provider-spezifische Tenant-Config (host/port/secure/from/authUser)
//      und Secret (smtp.password). Self-contained — mail-foundation kennt
//      diese Schlüssel nicht; wenn ein App-Owner zwischen SMTP und Brevo-
//      API wechseln will, hat er pro-Plugin eigenständige Config-Sets.
//   2. **Plugin-Registration** via `r.useExtension("mailTransport",
//      "smtp", { build })`. Beim Boot kennt mail-foundation's
//      Factory-Lookup damit den name "smtp" ↔ build-Funktion.
//   3. `build(ctx, tenantId)` liest die config-keys + secret und ruft
//      `createSmtpTransport()` aus channel-email auf. Das ist der
//      EINZIGE Cross-Feature-Import dieses Plugins — bewusst lokal
//      gehalten, mail-foundation bleibt provider-frei.
//
// **Pattern-Vorbild:** mirrors `channel-email` registering itself for
// `delivery`. Diese Feature ist analog: registriert sich für
// mail-foundation's "mailTransport"-Extension-Point.
//
// **Boot-Dependencies:**
//   - `mail-foundation` — extension-point owner
//   - `config` — für die Tenant-Config-Keys
//   - `secrets` — für das verschlüsselte SMTP-Password

import {
  createSmtpTransport,
  type EmailTransport,
} from "@cosmicdrift/kumiko-bundled-features/channel-email";
import {
  requireDefined,
  requireNonEmpty,
  requireSecretSet,
} from "@cosmicdrift/kumiko-bundled-features/foundation-shared";
import type {
  MailTransportContext,
  MailTransportPlugin,
} from "@cosmicdrift/kumiko-bundled-features/mail-foundation";
import { requireSecretsContext } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { access, createTenantConfig, defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const FEATURE_NAME = "mail-transport-smtp";

// =============================================================================
// Feature-definition
// =============================================================================

export const mailTransportSmtpFeature = defineFeature(FEATURE_NAME, (r) => {
  r.describe(
    'Registers itself as the `"smtp"` provider for `mail-foundation` and owns the per-tenant config keys (`host`, `port`, `secure`, `from`, `authUser`) and the encrypted `smtp.password` secret. Tenants set `mail-foundation`\'s `provider` config key to `"smtp"` to activate it; set the SMTP credentials via the admin UI or a seed handler before sending the first mail.',
  );
  r.uiHints({
    displayLabel: "Mail Transport · SMTP",
    category: "notifications",
    recommended: false,
  });
  r.requires("config");
  r.requires("secrets");
  r.requires("mail-foundation");

  // Provider-secret. Sensitive: redact-helper for admin-UI display.
  const password = r.secret("smtp.password", {
    label: { de: "SMTP-Passwort", en: "SMTP password" },
    hint: {
      de: "Login-Passwort am SMTP-Server. Bei Brevo/Postmark/SES heißt es 'API key' bzw. 'SMTP credentials'.",
      en: "Login password at the SMTP server. Brevo/Postmark/SES call it 'API key' or 'SMTP credentials'.",
    },
    redact: (plaintext) => {
      if (plaintext.length < 8) return "•".repeat(plaintext.length);
      return `${plaintext.slice(0, 3)}...${plaintext.slice(-2)}`;
    },
    scope: "tenant",
    // required: true ↔ the missing-secret throw in readPassword — keep in sync.
    required: true,
  });

  // required: true ↔ the requireNonEmpty calls in buildSmtpTransport — keep in sync.
  const configKeys = r.config({
    keys: {
      host: createTenantConfig("text", {
        required: true,
        default: "",
        write: access.roles("TenantAdmin", "SystemAdmin"),
        read: access.roles("TenantAdmin", "SystemAdmin"),
      }),
      port: createTenantConfig("number", {
        default: 587,
        bounds: { min: 1, max: 65535 },
        write: access.roles("TenantAdmin", "SystemAdmin"),
      }),
      secure: createTenantConfig("boolean", {
        default: false,
        write: access.roles("TenantAdmin", "SystemAdmin"),
      }),
      from: createTenantConfig("text", {
        required: true,
        default: "",
        write: access.roles("TenantAdmin", "SystemAdmin"),
        read: access.roles("TenantAdmin", "SystemAdmin"),
      }),
      authUser: createTenantConfig("text", {
        required: true,
        default: "",
        write: access.roles("TenantAdmin", "SystemAdmin"),
        read: access.roles("TenantAdmin", "SystemAdmin"),
      }),
    },
  });

  // Plugin: register against mail-foundation's "mailTransport" extension.
  // `entityName` "smtp" is what tenants set in mail-foundation's
  // `provider` config-key to pick this transport.
  const plugin: MailTransportPlugin = {
    build: async (ctx: MailTransportContext, tenantId: string) => buildSmtpTransport(ctx, tenantId), // @wrapper-known semantic-alias
  };
  r.useExtension("mailTransport", "smtp", plugin);

  return {
    /** Config-key-handles — typed reads via `ctx.config(...)` in
     *  consumer handlers. */
    configKeys,
    /** Secret-handle for the SMTP password. */
    password,
  };
});

/** Typed handle for the SMTP password — exported so seeds + tests can
 *  set it via `secrets:write:set` with the full qualified-name. */
export const SMTP_PASSWORD = mailTransportSmtpFeature.exports.password;

// =============================================================================
// Internal: build the EmailTransport from tenant config + secret
// =============================================================================

async function buildSmtpTransport(
  ctx: MailTransportContext,
  tenantId: string,
): Promise<EmailTransport> {
  const ctxConfig = ctx.config;
  if (!ctxConfig) {
    throw new Error(
      `${FEATURE_NAME}: ctx.config is missing — feature requires the config-feature mounted in the registry`,
    );
  }

  const SMTP_HINT = "Set via tenant-admin UI or seed-handler before sending mail.";
  const host = requireNonEmpty(
    await ctxConfig(mailTransportSmtpFeature.exports.configKeys.host),
    FEATURE_NAME,
    "host",
    SMTP_HINT,
  );
  const port = requireDefined(
    await ctxConfig(mailTransportSmtpFeature.exports.configKeys.port),
    FEATURE_NAME,
    "port",
  ) as number; // @cast-boundary engine-payload
  const secure = requireDefined(
    await ctxConfig(mailTransportSmtpFeature.exports.configKeys.secure),
    FEATURE_NAME,
    "secure",
  ) as boolean; // @cast-boundary engine-payload
  const from = requireNonEmpty(
    await ctxConfig(mailTransportSmtpFeature.exports.configKeys.from),
    FEATURE_NAME,
    "from",
    SMTP_HINT,
  );
  const authUser = requireNonEmpty(
    await ctxConfig(mailTransportSmtpFeature.exports.configKeys.authUser),
    FEATURE_NAME,
    "authUser",
    SMTP_HINT,
  );

  const password = await readPassword(ctx, tenantId);

  return createSmtpTransport({
    host,
    port,
    secure,
    from,
    auth: { user: authUser, pass: password },
  });
}

async function readPassword(ctx: MailTransportContext, tenantId: string): Promise<string> {
  const secrets = requireSecretsContext(ctx, FEATURE_NAME);
  const branded = await secrets.get(tenantId, SMTP_PASSWORD);
  return requireSecretSet(branded, FEATURE_NAME, SMTP_PASSWORD.name).reveal();
}
