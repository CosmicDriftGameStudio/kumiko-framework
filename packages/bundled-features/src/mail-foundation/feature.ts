// kumiko-feature-version: 1
//
// mail-foundation as a Kumiko bundled feature.
//
// **What this file gives you:**
//   1. **Tenant-scoped config** — provider, host, port, secure, from,
//      authUser. Tenant-Admin can set these in the Designer; downstream
//      handlers read via ctx.config.
//   2. **Tenant-scoped secret** — the SMTP password. BYOK is the default
//      model: each tenant's outbound mail goes through their own SMTP
//      account (Brevo, Postmark, SES, internal Postfix), so spam impacts
//      their reputation, not the platform's.
//   3. **createTransportForTenant(ctx, tenantId)** — bridges the
//      registry-config + secret into a ready-to-use `EmailTransport`
//      that a handler can hand to the existing channel-email transport
//      shape (auth-email-password reset/verification, custom
//      notification-flows). Per-call construction means a tenant editing
//      their config sees the change on the very next mail.
//
// **Pattern-Vorbild:** `ai-foundation` — selber Aufbau, selbe Trennung
// public-config (host/port/from sichtbar) vs encrypted-secret (password).
// Wer beide vergleicht: provider-agnostisch heute = nur SMTP, Brevo-/SES-
// API-Provider würden den `provider`-Switch in `createTransportForTenant`
// erweitern — config-options und secret-shape können stable bleiben.
//
// **Standalone:** Feature ist NICHT von tier-engine abhängig. Eine App
// die per-tenant-Mail-Versand will mountet mail-foundation auch ohne
// Pricing-/Tier-System. Existing `channel-email` (App-wide-Config)
// bleibt unangetastet — additive Feature, kein Refactor an bestehenden
// Apps.
//
// **Boot-Dependencies:** config + secrets, analog ai-foundation.

import { createSmtpTransport, type EmailTransport } from "@kumiko/bundled-features/channel-email";
import { requireDefined, requireNonEmpty } from "@kumiko/bundled-features/foundation-shared";
import { requireSecretsContext } from "@kumiko/bundled-features/secrets";
import {
  access,
  createTenantConfig,
  defineFeature,
  type HandlerContext,
} from "@kumiko/framework/engine";

const FEATURE_NAME = "mail-foundation";

// =============================================================================
// Feature-definition
// =============================================================================

export const mailFoundationFeature = defineFeature("mail-foundation", (r) => {
  r.requires("config");
  r.requires("secrets");

  // Sensitive part — SMTP password. Login/auth credentials at every SMTP
  // server. Same redact-helper-shape as ai-foundation's API key.
  const password = r.secret("smtp.password", {
    label: { de: "SMTP-Passwort", en: "SMTP password" },
    hint: {
      de: "Login-Passwort am SMTP-Server. Bei Brevo/Postmark/SES heißt es 'API key' bzw. 'SMTP credentials'.",
      en: "Login password at the SMTP server. Brevo/Postmark/SES call it 'API key' or 'SMTP credentials'.",
    },
    // Generic redaction: most SMTP-passwords are random-looking strings
    // 20-60 chars long, no documented prefix to surface like sk-ant-...
    redact: (plaintext) => {
      if (plaintext.length < 8) return "•".repeat(plaintext.length);
      return `${plaintext.slice(0, 3)}...${plaintext.slice(-2)}`;
    },
    scope: "tenant",
  });

  const configKeys = r.config({
    keys: {
      // Provider-selector. Sprint 2 = "smtp" only; Brevo-API, Postmark-API,
      // SES-API land later via the same EmailTransport interface.
      provider: createTenantConfig("select", {
        default: "smtp",
        options: ["smtp"],
        write: access.roles("TenantAdmin", "SystemAdmin"),
        read: access.roles("TenantAdmin", "SystemAdmin", "User"),
      }),
      // SMTP-server hostname.
      host: createTenantConfig("text", {
        default: "",
        write: access.roles("TenantAdmin", "SystemAdmin"),
        read: access.roles("TenantAdmin", "SystemAdmin"),
      }),
      // SMTP-server port. 587 is STARTTLS-default, 465 is implicit-TLS,
      // 25 is unencrypted (only for internal relays).
      port: createTenantConfig("number", {
        default: 587,
        bounds: { min: 1, max: 65535 },
        write: access.roles("TenantAdmin", "SystemAdmin"),
      }),
      // TLS-mode: true = implicit TLS (port 465), false = STARTTLS (587).
      // The createSmtpTransport defaults match.
      secure: createTenantConfig("boolean", {
        default: false,
        write: access.roles("TenantAdmin", "SystemAdmin"),
      }),
      // Default sender address. nodemailer-format: "user@dom.tld" or
      // "Display Name <user@dom.tld>".
      from: createTenantConfig("text", {
        default: "",
        write: access.roles("TenantAdmin", "SystemAdmin"),
        read: access.roles("TenantAdmin", "SystemAdmin"),
      }),
      // SMTP login username. Often the same as the from-address but can
      // diverge (Postmark uses a server-API-token-id as username).
      authUser: createTenantConfig("text", {
        default: "",
        write: access.roles("TenantAdmin", "SystemAdmin"),
        read: access.roles("TenantAdmin", "SystemAdmin"),
      }),
    },
  });

  return {
    /** Config-key-handles — typed reads via `ctx.config(...)` in
     *  consumer handlers. */
    configKeys,
    /** Secret-handle for the SMTP password. Use with
     *  `requireSecretsContext(ctx, ...).get(tenantId, password)`. */
    password,
  };
});

// =============================================================================
// Public re-export (typed handle for the SMTP password secret)
// =============================================================================

/** Typed handle for the SMTP password. */
export const SMTP_PASSWORD = mailFoundationFeature.exports.password;

// =============================================================================
// Transport-factory — the actual reason this file exists
// =============================================================================

/**
 * Async constructor: read tenant SMTP config + password from `ctx`, build
 * an `EmailTransport` matching the tenant's selected provider.
 *
 * **Pattern-Vorbild:** mirrors `createProviderForTenant` from
 * `ai-foundation`. Re-reads config + secret per call — a tenant editing
 * their SMTP config sees the change on the very next send. Caching the
 * transport per-tenant would require an invalidation hook; per-call
 * construction is cheap (nodemailer SMTP transport is just object-
 * allocation + first-send opens the connection-pool lazily).
 *
 * **Returns the `EmailTransport` interface from `channel-email`** —
 * compatible with the existing send-helpers (delivery channels, auth
 * email-password reset). A handler can hand the result straight into
 * any code that already takes an EmailTransport.
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
      "mail-foundation: ctx.config is missing — feature requires the config-feature mounted in the registry",
    );
  }

  const provider = requireDefined(
    await ctxConfig(mailFoundationFeature.exports.configKeys.provider),
    FEATURE_NAME,
    "provider",
  ) as string;
  const host = requireNonEmpty(
    await ctxConfig(mailFoundationFeature.exports.configKeys.host),
    FEATURE_NAME,
    "host",
    "Set host via tenant-admin UI or seed-handler before sending mail.",
  );
  const port = requireDefined(
    await ctxConfig(mailFoundationFeature.exports.configKeys.port),
    FEATURE_NAME,
    "port",
  ) as number;
  const secure = requireDefined(
    await ctxConfig(mailFoundationFeature.exports.configKeys.secure),
    FEATURE_NAME,
    "secure",
  ) as boolean;
  const from = requireNonEmpty(
    await ctxConfig(mailFoundationFeature.exports.configKeys.from),
    FEATURE_NAME,
    "from",
    "Set from via tenant-admin UI or seed-handler before sending mail.",
  );
  const authUser = requireNonEmpty(
    await ctxConfig(mailFoundationFeature.exports.configKeys.authUser),
    FEATURE_NAME,
    "authUser",
    "Set authUser via tenant-admin UI or seed-handler before sending mail.",
  );

  const password = await readPassword(ctx, tenantId, handlerName);

  switch (provider) {
    case "smtp":
      return createSmtpTransport({
        host,
        port,
        secure,
        from,
        auth: { user: authUser, pass: password },
      });
    default:
      throw new Error(
        `mail-foundation: provider "${provider}" not implemented (only "smtp" today)`,
      );
  }
}

// =============================================================================
// Internal helpers
// =============================================================================

async function readPassword(
  ctx: HandlerContext,
  tenantId: string,
  handlerName: string,
): Promise<string> {
  const secrets = requireSecretsContext(ctx, handlerName);
  const branded = await secrets.get(tenantId, SMTP_PASSWORD);
  if (!branded) {
    throw new Error(
      `mail-foundation: ${SMTP_PASSWORD.name} not set for tenant ${tenantId} — Tenant-Admin must set it via /api/write/secrets:write:set`,
    );
  }
  return branded.reveal();
}
