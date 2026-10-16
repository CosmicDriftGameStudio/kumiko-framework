// English texts and expiry formatting for the transactional auth mails. The
// mail bodies are built from these keys into stored templates (see
// mail-notifications.ts).
//
// English ships here. Other languages register via @cosmicdrift/kumiko-locale-*
// (localeDe() / localeEs() call registerMailTranslations).

import { registerMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";

export type AuthMailLocale = string;

export const AUTH_MAIL_EN: Readonly<Record<string, string>> = {
  "auth.mail.appNameDefault": "Account",
  "auth.mail.reset.subject": "{app} — Reset your password",
  "auth.mail.reset.greeting": "Hi,",
  "auth.mail.reset.intro":
    "you requested a password reset for {app}. Click the link below to set a new password:",
  "auth.mail.reset.button": "Reset password",
  "auth.mail.reset.expiry": "The link is valid for {duration} (until {when}).",
  "auth.mail.reset.ignore":
    "If you didn't request a reset, you can safely ignore this email — your password won't change.",
  "auth.mail.verify.subject": "{app} — Verify your email",
  "auth.mail.verify.greeting": "Welcome,",
  "auth.mail.verify.intro": "please verify your email address for {app} to activate your account:",
  "auth.mail.verify.button": "Verify email",
  "auth.mail.verify.expiry": "The link is valid for {duration} (until {when}).",
  "auth.mail.verify.ignore": "If you didn't create this account, you can ignore this email.",
  "auth.mail.activation.subject": "{app} — Activate your account",
  "auth.mail.activation.greeting": "Welcome,",
  "auth.mail.activation.intro":
    "click the link below to activate your {app} account. The next step is choosing your password:",
  "auth.mail.activation.button": "Activate account",
  "auth.mail.activation.expiry": "The link is valid for {duration} (until {when}).",
  "auth.mail.activation.ignore":
    "If you didn't sign up, you can ignore this email — no account is created until you open the link.",
  "auth.mail.invite.subject": "{app} — Workspace invitation",
  "auth.mail.invite.greeting": "Hi,",
  "auth.mail.invite.intro":
    "you've been invited to a {app} workspace as {role}. Click the link below to accept:",
  "auth.mail.invite.button": "Accept invitation",
  "auth.mail.invite.expiry": "The link is valid for {duration} (until {when}).",
  "auth.mail.invite.ignore": "If you weren't expecting this invitation, you can ignore this email.",
  "auth.mail.unlock.subject": "{app} — Unlock your account",
  "auth.mail.unlock.greeting": "Hi,",
  "auth.mail.unlock.intro":
    "your {app} account was temporarily locked after several failed sign-in attempts. Click the link below to unlock it immediately:",
  "auth.mail.unlock.button": "Unlock account",
  "auth.mail.unlock.expiry": "The link is valid for {duration} (until {when}).",
  "auth.mail.unlock.ignore":
    "If you didn't trigger this lock, you can ignore this email — the lock expires on its own.",
};

registerMailTranslations("en", AUTH_MAIL_EN);

export type TokenMailTiming = {
  readonly expiresAt: string;
  /** ISO instant the token was issued; the validity duration is measured from it. Default: now. */
  readonly issuedAt?: string;
  /** IANA zone the expiry time is shown in. Default "UTC"; an invalid zone falls back to "UTC". */
  readonly timeZone?: string;
};

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

type DurationUnit = "day" | "hour" | "minute";

// Rounds to whole minutes first so a few ms between issuing and signing still
// read as "1 day"; a larger unit is only used when it divides the span exactly.
function durationParts(ms: number): { readonly amount: number; readonly unit: DurationUnit } {
  const minutes = Math.max(1, Math.round(ms / MS_PER_MINUTE));
  const minutesPerHour = MS_PER_HOUR / MS_PER_MINUTE;
  const minutesPerDay = MS_PER_DAY / MS_PER_MINUTE;
  if (minutes % minutesPerDay === 0) return { amount: minutes / minutesPerDay, unit: "day" };
  if (minutes % minutesPerHour === 0) return { amount: minutes / minutesPerHour, unit: "hour" };
  return { amount: minutes, unit: "minute" };
}

function formatDuration(ms: number, locale: string): string {
  const { amount, unit } = durationParts(ms);
  const options: Intl.NumberFormatOptions = { style: "unit", unit, unitDisplay: "long" };
  try {
    return new Intl.NumberFormat(locale, options).format(amount);
  } catch {
    return new Intl.NumberFormat("en", options).format(amount);
  }
}

// Intl rejects timeZoneName together with dateStyle/timeStyle, so the zone
// abbreviation is read from a second formatter and appended.
function formatWhen(expiresAt: Temporal.Instant, locale: string, timeZone: string): string {
  const build = (tag: string, zone: string): string => {
    const at = expiresAt.epochMilliseconds;
    const dateTime = new Intl.DateTimeFormat(tag, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: zone,
    }).format(at);
    const zoneName = new Intl.DateTimeFormat(tag, { timeZone: zone, timeZoneName: "short" })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value;
    return zoneName ? `${dateTime} ${zoneName}` : dateTime;
  };
  try {
    return build(locale, timeZone);
  } catch {
    try {
      return build(locale, "UTC");
    } catch {
      return build("en", "UTC");
    }
  }
}

// Formatted as text here because the stored template only knows plain variables.
export function tokenMailExpiry(
  args: TokenMailTiming,
  locale: string,
): { readonly validFor: string; readonly validUntil: string } {
  try {
    const expiresAt = Temporal.Instant.from(args.expiresAt);
    const issuedAt = args.issuedAt ? Temporal.Instant.from(args.issuedAt) : Temporal.Now.instant();
    return {
      validFor: formatDuration(expiresAt.epochMilliseconds - issuedAt.epochMilliseconds, locale),
      validUntil: formatWhen(expiresAt, locale, args.timeZone ?? "UTC"),
    };
  } catch {
    return { validFor: args.expiresAt, validUntil: args.expiresAt };
  }
}
