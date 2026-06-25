// Default send*Email-Callbacks fuer die GDPR-Notifications, backed by einem
// mail-transport (mail-foundation). Damit muss eine App keinen Callback-Code
// schreiben: sie mountet mail-foundation + einen mail-transport-* und setzt
// fuer Export-Mails appExportDownloadUrl — fertig. Uebergibt sie eigene
// send*Email-Opts, greifen diese Defaults nicht (Opt-Override im feature.ts).
//
// Jeder Callback rendert das Template (email-templates.ts) und versendet ueber
// den per-Tenant aufgeloesten EmailTransport. `resolveTransport` kommt im Job-
// Lane aus makeTenantMailTransportResolver, im Request-Lane direkt aus
// createTransportForTenant(ctx, ...).

import type { EmailTransport } from "@cosmicdrift/kumiko-bundled-features/channel-email";
import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import {
  type GdprMailLocale,
  normalizeGdprMailLocale,
  renderDeletionExecutedEmail,
  renderDeletionRequestedEmail,
  renderExportFailedEmail,
  renderExportReadyEmail,
} from "../email-templates";
import type { SendDeletionRequestedEmailFn } from "../handlers/request-deletion.write";
import type { SendExportFailedEmailFn, SendExportReadyEmailFn } from "../run-export-jobs";
import type { SendDeletionExecutedEmailFn } from "../run-forget-cleanup";

export type GdprMailDefaults = {
  readonly locale?: GdprMailLocale;
  readonly appName?: string;
};

// mail-foundation ist eine Soft-Dep von user-data-rights. Die Default-Mailer
// greifen nur wenn mindestens ein mail-transport-* registriert ist — sonst
// kann ohnehin nichts versendet werden und die App bleibt beim bisherigen
// "kein Callback → keine Email"-Verhalten.
export function isMailTransportAvailable(registry: Registry): boolean {
  return registry.getExtensionUsages("mailTransport").length > 0;
}

type TransportResolver = (tenantId: string) => Promise<EmailTransport>;

// Per-recipient locale wins (user.locale); mailDefaults.locale is the fallback
// for unknown/unsupported user.locale values; the template itself defaults to en.
function localeFor(
  userLocale: string | null,
  defaults: GdprMailDefaults,
): GdprMailLocale | undefined {
  return normalizeGdprMailLocale(userLocale) ?? defaults.locale;
}

export function makeDefaultExportReadyEmail(
  resolveTransport: TransportResolver,
  defaults: GdprMailDefaults = {},
): SendExportReadyEmailFn {
  return async (args) => {
    const transport = await resolveTransport(args.tenantId);
    const { subject, html } = renderExportReadyEmail({
      downloadUrl: args.downloadUrl,
      expiresAt: args.expiresAt,
      locale: localeFor(args.userLocale, defaults),
      appName: defaults.appName,
    });
    await transport.send({ to: args.userEmail, subject, html });
  };
}

export function makeDefaultExportFailedEmail(
  resolveTransport: TransportResolver,
  defaults: GdprMailDefaults = {},
): SendExportFailedEmailFn {
  return async (args) => {
    const transport = await resolveTransport(args.tenantId);
    const { subject, html } = renderExportFailedEmail({
      locale: localeFor(args.userLocale, defaults),
      appName: defaults.appName,
    });
    await transport.send({ to: args.userEmail, subject, html });
  };
}

export function makeDefaultDeletionRequestedEmail(
  resolveTransport: TransportResolver,
  defaults: GdprMailDefaults = {},
): SendDeletionRequestedEmailFn {
  return async (args) => {
    const transport = await resolveTransport(args.tenantId);
    const { subject, html } = renderDeletionRequestedEmail({
      gracePeriodEnd: args.gracePeriodEnd,
      locale: localeFor(args.userLocale, defaults),
      appName: defaults.appName,
    });
    await transport.send({ to: args.userEmail, subject, html });
  };
}

export function makeDefaultDeletionExecutedEmail(
  resolveTransport: TransportResolver,
  defaults: GdprMailDefaults = {},
): SendDeletionExecutedEmailFn {
  return async (args) => {
    // Der User ist global, der Mail-Transport per-Tenant — wir senden ueber den
    // Transport des ersten Memberships. Orphan-User (0 Memberships) liefert
    // keine Tenant-Identitaet → kein Transport aufloesbar, Mail entfaellt.
    const tenantId = args.tenantIds[0];
    if (tenantId === undefined) {
      // skip: orphan user has no tenant whose transport could send the mail
      return;
    }
    const transport = await resolveTransport(tenantId);
    const { subject, html } = renderDeletionExecutedEmail({
      executedAt: args.executedAt,
      locale: localeFor(args.userLocale, defaults),
      appName: defaults.appName,
    });
    await transport.send({ to: args.userEmail, subject, html });
  };
}
