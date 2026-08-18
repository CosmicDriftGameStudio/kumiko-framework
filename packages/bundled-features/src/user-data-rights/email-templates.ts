// Default HTML renderers for GDPR notification mails. English ships here;
// other languages register via @cosmicdrift/kumiko-locale-* (localeDe() /
// localeEs() call registerMailTranslations). Apps that want their own
// branding pass send*Email callbacks and these defaults do not run.

import { mailT, registerMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";
import { escapeHtml, escapeHtmlAttr } from "@cosmicdrift/kumiko-headless";
import { Temporal } from "temporal-polyfill";

export type GdprMailLocale = string;

export function normalizeGdprMailLocale(
  raw: string | null | undefined,
): GdprMailLocale | undefined {
  if (!raw) return undefined;
  const root = raw.toLowerCase().split("-")[0];
  return root && root.length > 0 ? root : undefined;
}

const GDPR_MAIL_EN: Readonly<Record<string, string>> = {
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
  "gdpr.mail.fallbackUrl": "If the button doesn't work, copy this link into your browser:",
};

registerMailTranslations("en", GDPR_MAIL_EN);

export type RenderedEmail = {
  readonly subject: string;
  readonly html: string;
};

export type RenderExportReadyEmailArgs = {
  readonly downloadUrl: string;
  readonly expiresAt: string;
  readonly locale?: GdprMailLocale;
  readonly appName?: string;
};

export type RenderExportFailedEmailArgs = {
  readonly locale?: GdprMailLocale;
  readonly appName?: string;
};

export type RenderDeletionRequestedEmailArgs = {
  readonly gracePeriodEnd: string;
  readonly locale?: GdprMailLocale;
  readonly appName?: string;
};

export type RenderDeletionExecutedEmailArgs = {
  readonly executedAt: string;
  readonly locale?: GdprMailLocale;
  readonly appName?: string;
};

function t(locale: string, key: string, params?: Readonly<Record<string, string>>): string {
  return mailT(locale, key, params);
}

function appNameFor(args: { locale?: GdprMailLocale; appName?: string }): string {
  const locale = args.locale ?? "en";
  return args.appName ?? t(locale, "gdpr.mail.appNameDefault");
}

export function renderExportReadyEmail(args: RenderExportReadyEmailArgs): RenderedEmail {
  const locale = args.locale ?? "en";
  const app = appNameFor(args);
  const subject = t(locale, "gdpr.mail.exportReady.subject", { app });
  const body = `
    <p style="margin: 0 0 16px; font-size: 16px;">${escapeHtml(t(locale, "gdpr.mail.greeting"))}</p>
    <p style="margin: 0 0 24px; font-size: 14px; line-height: 1.5;">${escapeHtml(t(locale, "gdpr.mail.exportReady.intro", { app }))}</p>
    <p style="margin: 0 0 24px;">${renderButton({ url: args.downloadUrl, label: t(locale, "gdpr.mail.exportReady.button") })}</p>
    <p style="margin: 0 0 8px; font-size: 13px; color: #555;">${escapeHtml(t(locale, "gdpr.mail.exportReady.expiry", { when: formatTimestamp(args.expiresAt) }))}</p>
    ${renderFallbackUrl({ url: args.downloadUrl, label: t(locale, "gdpr.mail.fallbackUrl") })}`;
  return { subject, html: renderShell({ title: subject, bodyHtml: wrapCell(body), locale }) };
}

export function renderExportFailedEmail(args: RenderExportFailedEmailArgs): RenderedEmail {
  const locale = args.locale ?? "en";
  const app = appNameFor(args);
  const subject = t(locale, "gdpr.mail.exportFailed.subject", { app });
  const body = `
    <p style="margin: 0 0 16px; font-size: 16px;">${escapeHtml(t(locale, "gdpr.mail.greeting"))}</p>
    <p style="margin: 0; font-size: 14px; line-height: 1.5;">${escapeHtml(t(locale, "gdpr.mail.exportFailed.intro", { app }))}</p>`;
  return { subject, html: renderShell({ title: subject, bodyHtml: wrapCell(body), locale }) };
}

export function renderDeletionRequestedEmail(
  args: RenderDeletionRequestedEmailArgs,
): RenderedEmail {
  const locale = args.locale ?? "en";
  const app = appNameFor(args);
  const when = formatTimestamp(args.gracePeriodEnd);
  const subject = t(locale, "gdpr.mail.deletionRequested.subject", { app });
  const body = `
    <p style="margin: 0 0 16px; font-size: 16px;">${escapeHtml(t(locale, "gdpr.mail.greeting"))}</p>
    <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.5;">${escapeHtml(t(locale, "gdpr.mail.deletionRequested.intro", { app, when }))}</p>
    <p style="margin: 0; font-size: 13px; color: #555;">${escapeHtml(t(locale, "gdpr.mail.deletionRequested.cancel"))}</p>`;
  return { subject, html: renderShell({ title: subject, bodyHtml: wrapCell(body), locale }) };
}

export function renderDeletionExecutedEmail(args: RenderDeletionExecutedEmailArgs): RenderedEmail {
  const locale = args.locale ?? "en";
  const app = appNameFor(args);
  const when = formatTimestamp(args.executedAt);
  const subject = t(locale, "gdpr.mail.deletionExecuted.subject", { app });
  const body = `
    <p style="margin: 0 0 16px; font-size: 16px;">${escapeHtml(t(locale, "gdpr.mail.greeting"))}</p>
    <p style="margin: 0; font-size: 14px; line-height: 1.5;">${escapeHtml(t(locale, "gdpr.mail.deletionExecuted.intro", { app, when }))}</p>`;
  return { subject, html: renderShell({ title: subject, bodyHtml: wrapCell(body), locale }) };
}

function wrapCell(bodyHtml: string): string {
  return `<tr><td>${bodyHtml}</td></tr>`;
}

function renderShell(args: { title: string; bodyHtml: string; locale: GdprMailLocale }): string {
  return `<!DOCTYPE html>
<html lang="${args.locale}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(args.title)}</title>
  </head>
  <body style="margin: 0; padding: 0; background: #f7f7f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding: 24px 0;">
      <tr>
        <td align="center">
          <table width="560" cellpadding="0" cellspacing="0" style="max-width: 560px; background: #ffffff; border-radius: 8px; padding: 32px;">
            ${args.bodyHtml}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderButton(args: { url: string; label: string }): string {
  return `<a href="${escapeHtmlAttr(args.url)}" style="display: inline-block; background: #1a1a1a; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">${escapeHtml(args.label)}</a>`;
}

function renderFallbackUrl(args: { url: string; label: string }): string {
  return `<p style="margin: 24px 0 0; font-size: 12px; color: #666;">${escapeHtml(args.label)}<br /><a href="${escapeHtmlAttr(args.url)}" style="color: #1a1a1a; word-break: break-all;">${escapeHtml(args.url)}</a></p>`;
}

function formatTimestamp(iso: string): string {
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
