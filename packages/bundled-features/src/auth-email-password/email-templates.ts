// Default-HTML-Renderer für die transactional Auth-Mails (Reset-Password
// + Verify-Email). Apps wiren die `sendResetEmail` / `sendVerificationEmail`
// callbacks im framework-config (siehe PasswordResetConfig im
// auth-routes.ts). Statt jede App selbst HTML zu schreiben, kann sie diese
// Renderer als one-liner nutzen:
//
//   passwordReset: {
//     sendResetEmail: ({ email, resetUrl, expiresAt }) =>
//       mailSender.send({
//         to: email,
//         ...renderResetPasswordEmail({ resetUrl, expiresAt, locale: "de" }),
//       }),
//   }
//
// Apps die ihr eigenes Branding wollen, schreiben einen eigenen Renderer
// und mischen ihn in. Die Templates hier sind bewusst plain HTML mit
// inline-styling — kein CSS-Framework, kein bild-asset. Mail-Clients
// rendern das verlässlich, und der Operator kann das HTML im Mailer-Log
// problemlos lesen.
//
// Locale: de + en. Apps mit anderen Sprachen rendern selbst.

export type AuthMailLocale = "de" | "en";

export type RenderResetPasswordEmailArgs = {
  readonly resetUrl: string;
  readonly expiresAt: string;
  readonly locale?: AuthMailLocale;
  /** Optional: App-Name fürs Subject + Header. Default "Account". */
  readonly appName?: string;
};

export type RenderVerifyEmailArgs = {
  readonly verificationUrl: string;
  readonly expiresAt: string;
  readonly locale?: AuthMailLocale;
  readonly appName?: string;
};

export type RenderedEmail = {
  readonly subject: string;
  readonly html: string;
};

const STRINGS = {
  de: {
    resetSubject: (app: string) => `${app} — Passwort zurücksetzen`,
    resetGreeting: "Hallo,",
    resetIntro: (app: string) =>
      `du hast den Reset deines Passworts für ${app} angefordert. Klicke auf den folgenden Link, um ein neues Passwort zu setzen:`,
    resetButton: "Passwort zurücksetzen",
    resetExpiry: (when: string) => `Der Link läuft am ${when} ab.`,
    resetIgnore:
      "Falls du keinen Reset angefordert hast, kannst du diese E-Mail einfach ignorieren — dein Passwort bleibt unverändert.",
    verifySubject: (app: string) => `${app} — E-Mail bestätigen`,
    verifyGreeting: "Willkommen,",
    verifyIntro: (app: string) =>
      `bitte bestätige deine E-Mail-Adresse für ${app}, um dein Konto zu aktivieren:`,
    verifyButton: "E-Mail bestätigen",
    verifyExpiry: (when: string) => `Der Link läuft am ${when} ab.`,
    verifyIgnore: "Falls du dieses Konto nicht angelegt hast, kannst du diese E-Mail ignorieren.",
    fallbackUrl: "Falls der Button nicht funktioniert, kopiere diesen Link in den Browser:",
  },
  en: {
    resetSubject: (app: string) => `${app} — Reset your password`,
    resetGreeting: "Hi,",
    resetIntro: (app: string) =>
      `you requested a password reset for ${app}. Click the link below to set a new password:`,
    resetButton: "Reset password",
    resetExpiry: (when: string) => `The link expires on ${when}.`,
    resetIgnore:
      "If you didn't request a reset, you can safely ignore this email — your password won't change.",
    verifySubject: (app: string) => `${app} — Verify your email`,
    verifyGreeting: "Welcome,",
    verifyIntro: (app: string) =>
      `please verify your email address for ${app} to activate your account:`,
    verifyButton: "Verify email",
    verifyExpiry: (when: string) => `The link expires on ${when}.`,
    verifyIgnore: "If you didn't create this account, you can ignore this email.",
    fallbackUrl: "If the button doesn't work, copy this link into your browser:",
  },
} as const;

// Plain inline-styled HTML — funktioniert in Gmail/Outlook/Apple-Mail
// ohne dass wir Tailwind oder eine HTML-mail-Lib reinziehen müssen.
function renderShell(args: { title: string; bodyHtml: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
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
  return `<a href="${escapeAttr(args.url)}" style="display: inline-block; background: #1a1a1a; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">${escapeHtml(args.label)}</a>`;
}

function renderFallbackUrl(args: { url: string; label: string }): string {
  return `<p style="margin: 24px 0 0; font-size: 12px; color: #666;">${escapeHtml(args.label)}<br /><a href="${escapeAttr(args.url)}" style="color: #1a1a1a; word-break: break-all;">${escapeHtml(args.url)}</a></p>`;
}

export function renderResetPasswordEmail(args: RenderResetPasswordEmailArgs): RenderedEmail {
  const locale = args.locale ?? "en";
  const appName = args.appName ?? (locale === "de" ? "Konto" : "Account");
  const t = STRINGS[locale];
  const subject = t.resetSubject(appName);
  const bodyHtml = `
    <tr><td>
      <p style="margin: 0 0 16px; font-size: 16px;">${escapeHtml(t.resetGreeting)}</p>
      <p style="margin: 0 0 24px; font-size: 14px; line-height: 1.5;">${escapeHtml(t.resetIntro(appName))}</p>
      <p style="margin: 0 0 24px;">${renderButton({ url: args.resetUrl, label: t.resetButton })}</p>
      <p style="margin: 0 0 8px; font-size: 13px; color: #555;">${escapeHtml(t.resetExpiry(formatExpiry(args.expiresAt, locale)))}</p>
      <p style="margin: 0; font-size: 13px; color: #555;">${escapeHtml(t.resetIgnore)}</p>
      ${renderFallbackUrl({ url: args.resetUrl, label: t.fallbackUrl })}
    </td></tr>`;
  return { subject, html: renderShell({ title: subject, bodyHtml }) };
}

export function renderVerifyEmail(args: RenderVerifyEmailArgs): RenderedEmail {
  const locale = args.locale ?? "en";
  const appName = args.appName ?? (locale === "de" ? "Konto" : "Account");
  const t = STRINGS[locale];
  const subject = t.verifySubject(appName);
  const bodyHtml = `
    <tr><td>
      <p style="margin: 0 0 16px; font-size: 16px;">${escapeHtml(t.verifyGreeting)}</p>
      <p style="margin: 0 0 24px; font-size: 14px; line-height: 1.5;">${escapeHtml(t.verifyIntro(appName))}</p>
      <p style="margin: 0 0 24px;">${renderButton({ url: args.verificationUrl, label: t.verifyButton })}</p>
      <p style="margin: 0 0 8px; font-size: 13px; color: #555;">${escapeHtml(t.verifyExpiry(formatExpiry(args.expiresAt, locale)))}</p>
      <p style="margin: 0; font-size: 13px; color: #555;">${escapeHtml(t.verifyIgnore)}</p>
      ${renderFallbackUrl({ url: args.verificationUrl, label: t.fallbackUrl })}
    </td></tr>`;
  return { subject, html: renderShell({ title: subject, bodyHtml }) };
}

// expiresAt wird als raw ISO-String ausgegeben (z.B. "2026-05-04T13:45:00Z").
// Mail-Clients zeigen das verständlich genug; eine date-API hier wäre
// Temporal-Boilerplate für einen einmal-pro-Mail-Path. Apps die
// schöneres Format wollen, schreiben einen eigenen renderer.
function formatExpiry(iso: string, _locale: AuthMailLocale): string {
  return iso;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
