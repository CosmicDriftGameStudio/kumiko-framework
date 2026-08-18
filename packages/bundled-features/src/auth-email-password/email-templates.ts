// Default renderers for the transactional auth mails. All four magic-link flows
// (password-reset, email-verification, signup-activation, invite) emit
// structured AuthMailContent that the handler hands to delivery (ctx.notify) —
// renderer-simple turns it into HTML. Apps wanting their own branding swap the
// renderer; these templates are deliberately plain so the renderer (and the
// operator reading the mailer log) can rely on them.
//
// English ships here. Other languages register via @cosmicdrift/kumiko-locale-*
// (localeDe() / localeEs() call registerMailTranslations).

import { mailT, registerMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";
import { Temporal } from "temporal-polyfill";

export type AuthMailLocale = string;

const AUTH_MAIL_EN: Readonly<Record<string, string>> = {
  "auth.mail.appNameDefault": "Account",
  "auth.mail.reset.subject": "{app} — Reset your password",
  "auth.mail.reset.greeting": "Hi,",
  "auth.mail.reset.intro":
    "you requested a password reset for {app}. Click the link below to set a new password:",
  "auth.mail.reset.button": "Reset password",
  "auth.mail.reset.expiry": "The link expires on {when}.",
  "auth.mail.reset.ignore":
    "If you didn't request a reset, you can safely ignore this email — your password won't change.",
  "auth.mail.verify.subject": "{app} — Verify your email",
  "auth.mail.verify.greeting": "Welcome,",
  "auth.mail.verify.intro": "please verify your email address for {app} to activate your account:",
  "auth.mail.verify.button": "Verify email",
  "auth.mail.verify.expiry": "The link expires on {when}.",
  "auth.mail.verify.ignore": "If you didn't create this account, you can ignore this email.",
  "auth.mail.activation.subject": "{app} — Activate your account",
  "auth.mail.activation.greeting": "Welcome,",
  "auth.mail.activation.intro":
    "click the link below to activate your {app} account. The next step is choosing your password:",
  "auth.mail.activation.button": "Activate account",
  "auth.mail.activation.expiry": "The link expires on {when}.",
  "auth.mail.activation.ignore":
    "If you didn't sign up, you can ignore this email — no account is created until you open the link.",
  "auth.mail.invite.subject": "{app} — Workspace invitation",
  "auth.mail.invite.greeting": "Hi,",
  "auth.mail.invite.intro":
    "you've been invited to a {app} workspace as {role}. Click the link below to accept:",
  "auth.mail.invite.button": "Accept invitation",
  "auth.mail.invite.expiry": "The link expires on {when}.",
  "auth.mail.invite.ignore": "If you weren't expecting this invitation, you can ignore this email.",
  "auth.mail.unlock.subject": "{app} — Unlock your account",
  "auth.mail.unlock.greeting": "Hi,",
  "auth.mail.unlock.intro":
    "your {app} account was temporarily locked after several failed sign-in attempts. Click the link below to unlock it immediately:",
  "auth.mail.unlock.button": "Unlock account",
  "auth.mail.unlock.expiry": "The link expires on {when}.",
  "auth.mail.unlock.ignore":
    "If you didn't trigger this lock, you can ignore this email — the lock expires on its own.",
};

registerMailTranslations("en", AUTH_MAIL_EN);

export type RenderTokenContentArgs = {
  readonly url: string;
  readonly expiresAt: string;
  readonly locale?: AuthMailLocale;
  /** Optional app name for subject + intro. Default from auth.mail.appNameDefault. */
  readonly appName?: string;
};

export type RenderInviteEmailArgs = RenderTokenContentArgs & { readonly role: string };

export type AuthMailSection =
  | { readonly text: string }
  | { readonly button: { readonly label: string; readonly url: string } };

export type AuthMailContent = {
  readonly subject: string;
  readonly header: string;
  readonly sections: readonly AuthMailSection[];
  readonly footer: string;
};

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

function t(locale: string, key: string, params?: Readonly<Record<string, string>>): string {
  return mailT(locale, key, params);
}

function appNameFor(args: RenderTokenContentArgs): string {
  const locale = args.locale ?? "en";
  return args.appName ?? t(locale, "auth.mail.appNameDefault");
}

export function renderResetPasswordEmail(args: RenderTokenContentArgs): AuthMailContent {
  const locale = args.locale ?? "en";
  const app = appNameFor(args);
  return tokenMailContent({
    subject: t(locale, "auth.mail.reset.subject", { app }),
    header: t(locale, "auth.mail.reset.button"),
    greeting: t(locale, "auth.mail.reset.greeting"),
    intro: t(locale, "auth.mail.reset.intro", { app }),
    buttonLabel: t(locale, "auth.mail.reset.button"),
    buttonUrl: args.url,
    expiry: t(locale, "auth.mail.reset.expiry", { when: formatExpiry(args.expiresAt) }),
    ignore: t(locale, "auth.mail.reset.ignore"),
  });
}

export function renderUnlockAccountEmail(args: RenderTokenContentArgs): AuthMailContent {
  const locale = args.locale ?? "en";
  const app = appNameFor(args);
  return tokenMailContent({
    subject: t(locale, "auth.mail.unlock.subject", { app }),
    header: t(locale, "auth.mail.unlock.button"),
    greeting: t(locale, "auth.mail.unlock.greeting"),
    intro: t(locale, "auth.mail.unlock.intro", { app }),
    buttonLabel: t(locale, "auth.mail.unlock.button"),
    buttonUrl: args.url,
    expiry: t(locale, "auth.mail.unlock.expiry", { when: formatExpiry(args.expiresAt) }),
    ignore: t(locale, "auth.mail.unlock.ignore"),
  });
}

export function renderVerifyEmail(args: RenderTokenContentArgs): AuthMailContent {
  const locale = args.locale ?? "en";
  const app = appNameFor(args);
  return tokenMailContent({
    subject: t(locale, "auth.mail.verify.subject", { app }),
    header: t(locale, "auth.mail.verify.button"),
    greeting: t(locale, "auth.mail.verify.greeting"),
    intro: t(locale, "auth.mail.verify.intro", { app }),
    buttonLabel: t(locale, "auth.mail.verify.button"),
    buttonUrl: args.url,
    expiry: t(locale, "auth.mail.verify.expiry", { when: formatExpiry(args.expiresAt) }),
    ignore: t(locale, "auth.mail.verify.ignore"),
  });
}

export function renderActivationEmail(args: RenderTokenContentArgs): AuthMailContent {
  const locale = args.locale ?? "en";
  const app = appNameFor(args);
  return tokenMailContent({
    subject: t(locale, "auth.mail.activation.subject", { app }),
    header: t(locale, "auth.mail.activation.button"),
    greeting: t(locale, "auth.mail.activation.greeting"),
    intro: t(locale, "auth.mail.activation.intro", { app }),
    buttonLabel: t(locale, "auth.mail.activation.button"),
    buttonUrl: args.url,
    expiry: t(locale, "auth.mail.activation.expiry", { when: formatExpiry(args.expiresAt) }),
    ignore: t(locale, "auth.mail.activation.ignore"),
  });
}

export function renderInviteEmail(args: RenderInviteEmailArgs): AuthMailContent {
  const locale = args.locale ?? "en";
  const app = args.appName ?? "Workspace";
  return tokenMailContent({
    subject: t(locale, "auth.mail.invite.subject", { app }),
    header: t(locale, "auth.mail.invite.button"),
    greeting: t(locale, "auth.mail.invite.greeting"),
    intro: t(locale, "auth.mail.invite.intro", { app, role: args.role }),
    buttonLabel: t(locale, "auth.mail.invite.button"),
    buttonUrl: args.url,
    expiry: t(locale, "auth.mail.invite.expiry", { when: formatExpiry(args.expiresAt) }),
    ignore: t(locale, "auth.mail.invite.ignore"),
  });
}

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
