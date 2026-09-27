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

import type { lookup } from "node:dns/promises";
import {
  createSmtpTransport,
  type EmailTransport,
} from "@cosmicdrift/kumiko-bundled-features/channel-email";
import {
  BlockedHostError,
  HostResolutionError,
  MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR,
  type MailConnectTarget,
  readAllowedPrivateMailHostsFromEnv,
  requireDefined,
  requireNonEmpty,
  requireSecretSet,
  resolveMailConnectTarget,
} from "@cosmicdrift/kumiko-bundled-features/foundation-shared";
import {
  MAIL_TRANSPORT_EXTENSION,
  type MailTransportContext,
  type MailTransportPlugin,
} from "@cosmicdrift/kumiko-bundled-features/mail-foundation";
import { requireSecretsContext } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { access, createTenantConfig, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { UnconfiguredError } from "@cosmicdrift/kumiko-framework/errors";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import * as z from "zod";

const FEATURE_NAME = "mail-transport-smtp";

const log = createFallbackLogger(FEATURE_NAME);

// Operator escape hatch for an internal relay or a dev/test SMTP server
// (mailpit, MailHog): KUMIKO_MAIL_ALLOWED_PRIVATE_HOSTS, an operator env
// var never a tenant-config value, so a tenant can never grant themselves
// the private-host bypass. Declared here (not duplicated in
// inbound-provider-imap's envSchema) since both features read the same
// var and composeEnvSchema rejects two features declaring the same key —
// see foundation-shared/mail-host-policy.ts for the shared reader + the
// guard this feeds.
export const mailTransportSmtpEnvSchema = z.object({
  [MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR]: z
    .string()
    .optional()
    .describe(
      "Comma-separated operator allowlist of private/internal hosts (e.g. a local mailpit/greenmail dev server) that bypass the public-address check for SMTP and IMAP host config. Shared with inbound-provider-imap — never a tenant-config value.",
    ),
});

// Test-only DNS seam — production never calls this, resolveMailConnectTarget
// defaults to the real resolver. Lets tests pin deterministic, network-free
// host resolutions instead of depending on real DNS for a placeholder host.
// Reset it in afterEach/afterAll — this is module-global state.
let mailHostLookup: typeof lookup | undefined;

export function setSmtpMailHostLookup(fn: typeof lookup | undefined): void {
  mailHostLookup = fn;
}

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
  r.envSchema(mailTransportSmtpEnvSchema);

  // Provider-secret. Sensitive: redact-helper for admin-UI display.
  const password = r.secret("smtp.password", {
    label: { en: "SMTP password" },
    hint: {
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
  r.useExtension(MAIL_TRANSPORT_EXTENSION, "smtp", plugin);

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

// Tenant-visible for both a blocked host and a DNS failure — must not
// reveal which one occurred, or the host itself. Built once so a
// HostResolutionError raised for the other branch can reuse the exact same
// `.message` string byte-for-byte instead of just a similar hint.
function mailHostUnreachableError(): UnconfiguredError {
  return new UnconfiguredError({
    feature: FEATURE_NAME,
    key: "host",
    hint: "host is not reachable or not allowed",
  });
}

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

  let target: MailConnectTarget;
  try {
    target = await resolveMailConnectTarget(host, {
      allowedPrivateMailHosts: readAllowedPrivateMailHostsFromEnv(),
      lookupFn: mailHostLookup,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // Both branches throw the exact same tenant-visible message text — the
    // blocked-vs-unresolvable distinction and the host itself stay
    // server-log-only. Class stays distinct: UnconfiguredError (422, a
    // config problem, no retry) for a blocked host vs HostResolutionError
    // (transient, retried) for a DNS failure — see mailHostUnreachableError().
    const unreachable = mailHostUnreachableError();
    if (err instanceof BlockedHostError) {
      log.warn("rejected blocked host", { host, reason });
      throw unreachable;
    }
    log.warn("host resolution failed", { host, reason });
    throw new HostResolutionError(unreachable.message);
  }

  return createSmtpTransport({
    host: target.host,
    port,
    secure,
    from,
    auth: { user: authUser, pass: password },
    ...(target.servername && { servername: target.servername }),
  });
}

async function readPassword(ctx: MailTransportContext, tenantId: string): Promise<string> {
  const secrets = requireSecretsContext(ctx, FEATURE_NAME);
  const branded = await secrets.get(tenantId, SMTP_PASSWORD);
  return requireSecretSet(branded, FEATURE_NAME, SMTP_PASSWORD.name).reveal();
}
