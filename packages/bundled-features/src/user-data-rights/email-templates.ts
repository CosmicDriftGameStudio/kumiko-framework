// Translations for the GDPR notification mails (the templates in
// mail-notifications.ts are built from them). English ships here; other
// languages register via @cosmicdrift/kumiko-locale-* (localeDe() /
// localeEs() call registerMailTranslations). Apps that want their own
// branding pass send*Email callbacks and these defaults do not run.

import { registerMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";

export type GdprMailLocale = string;

export function normalizeGdprMailLocale(
  raw: string | null | undefined,
): GdprMailLocale | undefined {
  if (!raw) return undefined;
  const root = raw.toLowerCase().split("-")[0];
  return root && root.length > 0 ? root : undefined;
}

export const GDPR_MAIL_EN: Readonly<Record<string, string>> = {
  "gdpr.mail.appNameDefault": "Account",
  "gdpr.mail.greeting": "Hi,",
  "gdpr.mail.exportReady.subject": "{app} — Your data export is ready",
  "gdpr.mail.exportReady.intro":
    "your requested data export for {app} is ready. Download it using the link below:",
  "gdpr.mail.exportReady.button": "Download data export",
  "gdpr.mail.exportReady.expiry": "The download link expires on {when}.",
  "gdpr.mail.exportFailed.subject": "{app} — Your data export failed",
  "gdpr.mail.exportFailed.intro":
    "your requested data export for {app} could not be created. Please request the export again.",
  "gdpr.mail.deletionRequested.subject": "{app} — Account deletion requested",
  "gdpr.mail.deletionRequested.intro":
    "we received your request to delete your {app} account. Your account and associated data will be permanently deleted on {when}.",
  "gdpr.mail.deletionRequested.cancel":
    "If you didn't request this, sign in and cancel the deletion in your account settings before the deadline.",
  "gdpr.mail.deletionExecuted.subject": "{app} — Your account has been deleted",
  "gdpr.mail.deletionExecuted.intro":
    "your {app} account and the associated personal data were deleted on {when}. This action is permanent.",
};

registerMailTranslations("en", GDPR_MAIL_EN);

export function formatGdprMailTimestamp(iso: string): string {
  try {
    const z = Temporal.Instant.from(iso).toZonedDateTimeISO("UTC");
    return `${z.year}-${pad2(z.month)}-${pad2(z.day)} ${pad2(z.hour)}:${pad2(z.minute)} UTC`;
  } catch {
    return iso;
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
