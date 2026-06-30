// Default renderers for the transactional auth mails. All four magic-link flows
// (password-reset, email-verification, signup-activation, invite) emit
// structured AuthMailContent that the handler hands to delivery (ctx.notify) —
// renderer-simple turns it into HTML. Apps wanting their own branding swap the
// renderer; these templates are deliberately plain so the renderer (and the
// operator reading the mailer log) can rely on them.
//
// Locale: de + en. Apps with other languages render themselves.

import { Temporal } from "temporal-polyfill";

export type AuthMailLocale = "de" | "en";

// Unified args for the structured token-mail renderers (reset + verify).
// `url` is the fully-built magic-link — the handler already appended ?token=.
export type RenderTokenContentArgs = {
  readonly url: string;
  readonly expiresAt: string;
  readonly locale?: AuthMailLocale;
  /** Optional: App-Name fürs Subject + Header. Default "Account". */
  readonly appName?: string;
};

// Invite adds the role to the unified token-content args; `url` is the fully-
// built magic-link (the handler already appended ?token=).
export type RenderInviteEmailArgs = RenderTokenContentArgs & { readonly role: string };

export type AuthMailSection =
  | { readonly text: string }
  | { readonly button: { readonly label: string; readonly url: string } };

// Structured content the magic-link handlers pass as the delivery `data`
// payload: renderer-simple turns header/sections/footer into HTML, the
// email-channel reads `subject`. No pre-rendered HTML — the renderer owns layout.
export type AuthMailContent = {
  readonly subject: string;
  readonly header: string;
  readonly sections: readonly AuthMailSection[];
  readonly footer: string;
};

const STRINGS = {
  de: {
    resetSubject: (app: string) => `${app} — Passwort zurücksetzen`,
    resetGreeting: "Hallo,",
    // guard:dup-ok — false positive: i18n-String-Template, gleiche Arrow-Struktur wie anonymous fn in collect-table-metas
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
    activationSubject: (app: string) => `${app} — Account aktivieren`,
    activationGreeting: "Willkommen,",
    activationIntro: (app: string) =>
      `klicke auf den folgenden Link, um deinen ${app}-Account zu aktivieren. Im nächsten Schritt setzt du dein Passwort:`,
    activationButton: "Account aktivieren",
    activationExpiry: (when: string) => `Der Link läuft am ${when} ab.`,
    activationIgnore:
      "Falls du dich nicht registriert hast, kannst du diese E-Mail ignorieren — es wird kein Account erstellt, solange du den Link nicht öffnest.",
    inviteSubject: (app: string) => `${app} — Einladung zum Workspace`,
    inviteGreeting: "Hallo,",
    inviteIntro: (app: string, role: string) =>
      `du wurdest zu einem ${app}-Workspace als ${role} eingeladen. Klicke auf den folgenden Link, um die Einladung anzunehmen:`,
    inviteButton: "Einladung annehmen",
    inviteExpiry: (when: string) => `Der Link läuft am ${when} ab.`,
    inviteIgnore:
      "Falls du diese Einladung nicht erwartet hast, kannst du diese E-Mail ignorieren.",
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
    activationSubject: (app: string) => `${app} — Activate your account`,
    activationGreeting: "Welcome,",
    activationIntro: (app: string) =>
      `click the link below to activate your ${app} account. The next step is choosing your password:`,
    activationButton: "Activate account",
    activationExpiry: (when: string) => `The link expires on ${when}.`,
    activationIgnore:
      "If you didn't sign up, you can ignore this email — no account is created until you open the link.",
    inviteSubject: (app: string) => `${app} — Workspace invitation`,
    inviteGreeting: "Hi,",
    inviteIntro: (app: string, role: string) =>
      `you've been invited to a ${app} workspace as ${role}. Click the link below to accept:`,
    inviteButton: "Accept invitation",
    inviteExpiry: (when: string) => `The link expires on ${when}.`,
    inviteIgnore: "If you weren't expecting this invitation, you can ignore this email.",
  },
} as const;

// Structured content for the delivery path. header = action title (CTA label),
// sections = greeting/intro/button/expiry, footer = the "ignore if not you"
// reassurance. The old plain-text fallback-URL link drops out — renderer-simple
// has no link-text section and the button carries the URL.
function tokenMailContent(spec: {
  readonly subject: string;
  readonly header: string;
  readonly greeting: string;
  readonly intro: string;
  readonly buttonLabel: string;
  readonly buttonUrl: string;
  readonly expiry: string;
  readonly ignore: string;
}): AuthMailContent {
  return {
    subject: spec.subject,
    header: spec.header,
    sections: [
      { text: spec.greeting },
      { text: spec.intro },
      { button: { label: spec.buttonLabel, url: spec.buttonUrl } },
      { text: spec.expiry },
    ],
    footer: spec.ignore,
  };
}

export function renderResetPasswordEmail(args: RenderTokenContentArgs): AuthMailContent {
  const locale = args.locale ?? "en";
  const appName = args.appName ?? (locale === "de" ? "Konto" : "Account");
  const t = STRINGS[locale];
  return tokenMailContent({
    subject: t.resetSubject(appName),
    header: t.resetButton,
    greeting: t.resetGreeting,
    intro: t.resetIntro(appName),
    buttonLabel: t.resetButton,
    buttonUrl: args.url,
    expiry: t.resetExpiry(formatExpiry(args.expiresAt)),
    ignore: t.resetIgnore,
  });
}

export function renderVerifyEmail(args: RenderTokenContentArgs): AuthMailContent {
  const locale = args.locale ?? "en";
  const appName = args.appName ?? (locale === "de" ? "Konto" : "Account");
  const t = STRINGS[locale];
  return tokenMailContent({
    subject: t.verifySubject(appName),
    header: t.verifyButton,
    greeting: t.verifyGreeting,
    intro: t.verifyIntro(appName),
    buttonLabel: t.verifyButton,
    buttonUrl: args.url,
    expiry: t.verifyExpiry(formatExpiry(args.expiresAt)),
    ignore: t.verifyIgnore,
  });
}

export function renderActivationEmail(args: RenderTokenContentArgs): AuthMailContent {
  const locale = args.locale ?? "en";
  const appName = args.appName ?? (locale === "de" ? "Konto" : "Account");
  const t = STRINGS[locale];
  return tokenMailContent({
    subject: t.activationSubject(appName),
    header: t.activationButton,
    greeting: t.activationGreeting,
    intro: t.activationIntro(appName),
    buttonLabel: t.activationButton,
    buttonUrl: args.url,
    expiry: t.activationExpiry(formatExpiry(args.expiresAt)),
    ignore: t.activationIgnore,
  });
}

export function renderInviteEmail(args: RenderInviteEmailArgs): AuthMailContent {
  const locale = args.locale ?? "en";
  const appName = args.appName ?? "Workspace";
  const t = STRINGS[locale];
  return tokenMailContent({
    subject: t.inviteSubject(appName),
    header: t.inviteButton,
    greeting: t.inviteGreeting,
    intro: t.inviteIntro(appName, args.role),
    buttonLabel: t.inviteButton,
    buttonUrl: args.url,
    expiry: t.inviteExpiry(formatExpiry(args.expiresAt)),
    ignore: t.inviteIgnore,
  });
}

// ISO-Timestamp aus dem Token-Handler ("2026-05-04T13:45:00.000Z") in
// "2026-05-04 13:45 UTC" rendern. Locale-unabhängig damit der Mail-
// Renderer keine locale-spezifischen Number-Formatter mitschleppt; UTC-
// Suffix damit der User unabhängig von seiner Tz sieht wann der Link
// abläuft. Bei un-parsbarem Input fällt's auf den raw-string zurück.
function formatExpiry(iso: string): string {
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
