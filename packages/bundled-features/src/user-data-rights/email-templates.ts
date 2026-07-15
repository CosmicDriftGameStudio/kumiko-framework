// Default-HTML-Renderer fuer die GDPR-Notification-Mails (Export-bereit,
// Export-fehlgeschlagen, Loeschung-angefordert, Loeschung-ausgefuehrt).
// Damit eine App keine eigenen send*Email-Callbacks schreiben muss: sie
// mountet mail-foundation + einen mail-transport-* und user-data-rights
// rendert + versendet ueber diese Templates (siehe lib/default-mailers.ts).
//
// Apps die ihr eigenes Branding wollen, uebergeben eigene send*Email-Opts —
// dann greifen diese Defaults nicht. Pattern + plain-inline-HTML gespiegelt
// von auth-email-password/email-templates.ts (kein CSS-Framework, kein
// Bild-Asset; Mail-Clients rendern table-layout + inline-CSS verlaesslich).
//
// Locale: de + en. Apps mit anderen Sprachen uebergeben eigene Callbacks.

import { escapeHtml, escapeHtmlAttr } from "@cosmicdrift/kumiko-headless";
import { Temporal } from "temporal-polyfill";

export type GdprMailLocale = "de" | "en";

// user.locale ist Freitext ("de", "en", "de-DE", "fr", null). Die Templates
// koennen nur de/en — alles andere (inkl. unbekannte Sprachen) faellt auf
// undefined zurueck, sodass der Caller auf mailDefaults.locale bzw. "en" geht.
export function normalizeGdprMailLocale(
  raw: string | null | undefined,
): GdprMailLocale | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  if (lower.startsWith("de")) return "de";
  if (lower.startsWith("en")) return "en";
  return undefined;
}

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

const STRINGS = {
  de: {
    greeting: "Hallo,",
    exportReadySubject: (app: string) => `${app} — Dein Datenexport ist bereit`,
    exportReadyIntro: (app: string) =>
      `dein angeforderter Datenexport fuer ${app} ist fertig. Lade ihn ueber den folgenden Link herunter:`,
    exportReadyButton: "Datenexport herunterladen",
    exportReadyExpiry: (when: string) => `Der Download-Link laeuft am ${when} ab.`,
    exportFailedSubject: (app: string) => `${app} — Dein Datenexport ist fehlgeschlagen`,
    exportFailedIntro: (app: string) =>
      `dein angeforderter Datenexport fuer ${app} konnte leider nicht erstellt werden. Bitte fordere den Export erneut an.`,
    deletionRequestedSubject: (app: string) => `${app} — Loeschung deines Kontos angefordert`,
    deletionRequestedIntro: (app: string, when: string) =>
      `wir haben deinen Antrag zur Loeschung deines ${app}-Kontos erhalten. Dein Konto und die zugehoerigen Daten werden am ${when} endgueltig geloescht.`,
    deletionRequestedCancel:
      "Falls du das nicht angefordert hast, melde dich an und brich die Loeschung in den Kontoeinstellungen ab, bevor die Frist ablaeuft.",
    deletionExecutedSubject: (app: string) => `${app} — Dein Konto wurde geloescht`,
    deletionExecutedIntro: (app: string, when: string) =>
      `dein ${app}-Konto und die zugehoerigen personenbezogenen Daten wurden am ${when} geloescht. Diese Aktion ist endgueltig.`,
    fallbackUrl: "Falls der Button nicht funktioniert, kopiere diesen Link in den Browser:",
  },
  en: {
    greeting: "Hi,",
    exportReadySubject: (app: string) => `${app} — Your data export is ready`,
    exportReadyIntro: (app: string) =>
      `your requested data export for ${app} is ready. Download it using the link below:`,
    exportReadyButton: "Download data export",
    exportReadyExpiry: (when: string) => `The download link expires on ${when}.`,
    exportFailedSubject: (app: string) => `${app} — Your data export failed`,
    exportFailedIntro: (app: string) =>
      `your requested data export for ${app} could not be created. Please request the export again.`,
    deletionRequestedSubject: (app: string) => `${app} — Account deletion requested`,
    deletionRequestedIntro: (app: string, when: string) =>
      `we received your request to delete your ${app} account. Your account and associated data will be permanently deleted on ${when}.`,
    deletionRequestedCancel:
      "If you didn't request this, sign in and cancel the deletion in your account settings before the deadline.",
    deletionExecutedSubject: (app: string) => `${app} — Your account has been deleted`,
    deletionExecutedIntro: (app: string, when: string) =>
      `your ${app} account and the associated personal data were deleted on ${when}. This action is permanent.`,
    fallbackUrl: "If the button doesn't work, copy this link into your browser:",
  },
} as const;

function appNameFor(args: { locale?: GdprMailLocale; appName?: string }): string {
  const locale = args.locale ?? "en";
  return args.appName ?? (locale === "de" ? "Konto" : "Account");
}

export function renderExportReadyEmail(args: RenderExportReadyEmailArgs): RenderedEmail {
  const locale = args.locale ?? "en";
  const app = appNameFor(args);
  const t = STRINGS[locale];
  const subject = t.exportReadySubject(app);
  const body = `
    <p style="margin: 0 0 16px; font-size: 16px;">${escapeHtml(t.greeting)}</p>
    <p style="margin: 0 0 24px; font-size: 14px; line-height: 1.5;">${escapeHtml(t.exportReadyIntro(app))}</p>
    <p style="margin: 0 0 24px;">${renderButton({ url: args.downloadUrl, label: t.exportReadyButton })}</p>
    <p style="margin: 0 0 8px; font-size: 13px; color: #555;">${escapeHtml(t.exportReadyExpiry(formatTimestamp(args.expiresAt)))}</p>
    ${renderFallbackUrl({ url: args.downloadUrl, label: t.fallbackUrl })}`;
  return { subject, html: renderShell({ title: subject, bodyHtml: wrapCell(body), locale }) };
}

export function renderExportFailedEmail(args: RenderExportFailedEmailArgs): RenderedEmail {
  const locale = args.locale ?? "en";
  const app = appNameFor(args);
  const t = STRINGS[locale];
  const subject = t.exportFailedSubject(app);
  const body = `
    <p style="margin: 0 0 16px; font-size: 16px;">${escapeHtml(t.greeting)}</p>
    <p style="margin: 0; font-size: 14px; line-height: 1.5;">${escapeHtml(t.exportFailedIntro(app))}</p>`;
  return { subject, html: renderShell({ title: subject, bodyHtml: wrapCell(body), locale }) };
}

export function renderDeletionRequestedEmail(
  args: RenderDeletionRequestedEmailArgs,
): RenderedEmail {
  const locale = args.locale ?? "en";
  const app = appNameFor(args);
  const t = STRINGS[locale];
  const subject = t.deletionRequestedSubject(app);
  const body = `
    <p style="margin: 0 0 16px; font-size: 16px;">${escapeHtml(t.greeting)}</p>
    <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.5;">${escapeHtml(t.deletionRequestedIntro(app, formatTimestamp(args.gracePeriodEnd)))}</p>
    <p style="margin: 0; font-size: 13px; color: #555;">${escapeHtml(t.deletionRequestedCancel)}</p>`;
  return { subject, html: renderShell({ title: subject, bodyHtml: wrapCell(body), locale }) };
}

export function renderDeletionExecutedEmail(args: RenderDeletionExecutedEmailArgs): RenderedEmail {
  const locale = args.locale ?? "en";
  const app = appNameFor(args);
  const t = STRINGS[locale];
  const subject = t.deletionExecutedSubject(app);
  const body = `
    <p style="margin: 0 0 16px; font-size: 16px;">${escapeHtml(t.greeting)}</p>
    <p style="margin: 0; font-size: 14px; line-height: 1.5;">${escapeHtml(t.deletionExecutedIntro(app, formatTimestamp(args.executedAt)))}</p>`;
  return { subject, html: renderShell({ title: subject, bodyHtml: wrapCell(body), locale }) };
}

function wrapCell(bodyHtml: string): string {
  return `<tr><td>${bodyHtml}</td></tr>`;
}

// Plain inline-styled HTML — gespiegelt von auth-email-password.
// guard:dup-ok — Email-HTML (table-layout, inline CSS) ≠ Web-HTML (legal-pages/markdown.ts)
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

// guard:dup-ok — Email-HTML-Helper; selbe normalisierte AST-Form wie auth-email-password, verschiedene Semantik
function renderButton(args: { url: string; label: string }): string {
  return `<a href="${escapeHtmlAttr(args.url)}" style="display: inline-block; background: #1a1a1a; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">${escapeHtml(args.label)}</a>`;
}

// guard:dup-ok — Email-HTML-Helper; selbe normalisierte AST-Form wie auth-email-password, verschiedene Semantik
function renderFallbackUrl(args: { url: string; label: string }): string {
  return `<p style="margin: 24px 0 0; font-size: 12px; color: #666;">${escapeHtml(args.label)}<br /><a href="${escapeHtmlAttr(args.url)}" style="color: #1a1a1a; word-break: break-all;">${escapeHtml(args.url)}</a></p>`;
}

// ISO-Timestamp → "2026-05-04 13:45 UTC". Locale-unabhaengig + UTC-Suffix
// damit der User unabhaengig von seiner Tz sieht wann etwas passiert; bei
// un-parsbarem Input faellt's auf den raw-string zurueck.
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
