// kumiko-feature-version: 1
//
// mail-transport-smtp — concrete SMTP implementation for the
// mail-foundation plugin API.
//
// **What this feature provides:**
//   1. Provider-specific tenant config (host/port/secure/from/authUser)
//      and secret (smtp.password). Self-contained — mail-foundation does not
//      know these keys; when an app owner switches between SMTP and the Brevo
//      API, each plugin has its own independent config sets.
//   2. **Plugin registration** via `r.useExtension("mailTransport",
//      "smtp", { build })`. At boot, mail-foundation's factory lookup maps
//      the name "smtp" to the build function.
//   3. `build(ctx, tenantId)` reads the config keys and secret, then calls
//      `createSmtpTransport()` from channel-email. This is the plugin's
//      ONLY cross-feature import, deliberately kept local so
//      mail-foundation remains provider-independent.
//
// **Pattern reference:** mirrors `channel-email` registering itself for
// `delivery`. This feature is analogous: it registers for
// mail-foundation's "mailTransport" extension point.
//
// **Boot dependencies:**
//   - `mail-foundation` — extension-point owner
//   - `config` — for the tenant config keys
//   - `secrets` — for the encrypted SMTP password

import type { lookup } from "node:dns/promises";
import {
  createSmtpTransport,
  type EmailTransport,
} from "@cosmicdrift/kumiko-bundled-features/channel-email";
import {
  BlockedHostError,
  HostResolutionError,
  type MailConnectTarget,
  mailAllowedPrivateHostsEnvSchema,
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
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { UnconfiguredError } from "@cosmicdrift/kumiko-framework/errors";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import { SMTP_CONFIG_KEYS } from "./config-keys.ts";
import { MAIL_TRANSPORT_SMTP_I18N } from "./i18n.ts";

const FEATURE_NAME = "mail-transport-smtp";

const log = createFallbackLogger(FEATURE_NAME);

// Operator escape hatch for an internal relay or a dev/test SMTP server
// (mailpit, MailHog): KUMIKO_MAIL_ALLOWED_PRIVATE_HOSTS, an operator env
// var never a tenant-config value, so a tenant can never grant themselves
// the private-host bypass. The schema instance is shared with
// inbound-provider-imap (see foundation-shared/mail-host-policy.ts).
export const mailTransportSmtpEnvSchema = mailAllowedPrivateHostsEnvSchema;

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
export function createMailTransportSmtpFeature() {
  return defineFeature(
    FEATURE_NAME,
    (r) => {
      r.describe(
        'Registers itself as the `"smtp"` provider for `mail-foundation` and owns the per-tenant config keys (`host`, `port`, `secure`, `from`, `authUser`) and the encrypted `smtp.password` secret. Tenants set `mail-foundation`\'s `provider` config key to `"smtp"` to activate it; set the SMTP credentials via the admin UI or a seed handler before sending the first mail.',
      );
      r.uiHints({
        displayLabel: "Mail Transport · SMTP",
        category: "notifications",
        recommended: false,
      });
      r.requires({ features: ["config"] });
      r.requires({ features: ["secrets"] });
      r.requires({ features: ["mail-foundation"] });
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
        // Only needed once authUser is set (readPassword throws then), so readiness must not demand it.
      });

      const configKeys = r.config({ keys: SMTP_CONFIG_KEYS });

      r.translations({ keys: MAIL_TRANSPORT_SMTP_I18N });

      // Plugin: register against mail-foundation's "mailTransport" extension.
      // `entityName` "smtp" is what tenants set in mail-foundation's
      // `provider` config-key to pick this transport.
      const plugin: MailTransportPlugin = {
        build: async (ctx: MailTransportContext, tenantId: string) =>
          buildSmtpTransport(ctx, tenantId), // @wrapper-known semantic-alias
      };
      r.useExtension(MAIL_TRANSPORT_EXTENSION, "smtp", plugin);

      return {
        /** Config-key-handles — typed reads via `ctx.config(...)` in
         *  consumer handlers. */
        configKeys,
        /** Secret-handle for the SMTP password. */
        password,
      };
    },
    { dedupeOptions: {} },
  );
}

// The typed handles below come from one shared instance; each factory call builds its own handle objects.
const sharedMailTransportSmtpFeature = createMailTransportSmtpFeature();

/** Typed handle for the SMTP password — exported so seeds + tests can
 *  set it via `secrets:write:set` with the full qualified-name. */
export const SMTP_PASSWORD = sharedMailTransportSmtpFeature.exports.password;

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
    await ctxConfig(sharedMailTransportSmtpFeature.exports.configKeys.host),
    FEATURE_NAME,
    "host",
    SMTP_HINT,
  );
  const port = requireDefined(
    await ctxConfig(sharedMailTransportSmtpFeature.exports.configKeys.port),
    FEATURE_NAME,
    "port",
  ) as number; // @cast-boundary engine-payload
  const secure = requireDefined(
    await ctxConfig(sharedMailTransportSmtpFeature.exports.configKeys.secure),
    FEATURE_NAME,
    "secure",
  ) as boolean; // @cast-boundary engine-payload
  const from = requireNonEmpty(
    await ctxConfig(sharedMailTransportSmtpFeature.exports.configKeys.from),
    FEATURE_NAME,
    "from",
    SMTP_HINT,
  );
  const authUser = (
    await ctxConfig(sharedMailTransportSmtpFeature.exports.configKeys.authUser)
  )?.trim();
  const auth =
    authUser === undefined || authUser === ""
      ? undefined
      : { user: authUser, pass: await readPassword(ctx, tenantId) };

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
    ...(auth && { auth }),
    ...(target.servername && { servername: target.servername }),
  });
}

async function readPassword(ctx: MailTransportContext, tenantId: string): Promise<string> {
  const secrets = requireSecretsContext(ctx, FEATURE_NAME);
  const branded = await secrets.get(tenantId, SMTP_PASSWORD);
  return requireSecretSet(branded, FEATURE_NAME, SMTP_PASSWORD.name).reveal();
}
