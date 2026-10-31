// English defaults of the inactivity warning mail; other languages register through
// @cosmicdrift/kumiko-locale-* (same pattern as the GDPR mails).

import { registerMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";

export const INACTIVITY_MAIL_EN: Readonly<Record<string, string>> = {
  "inactivity.mail.warning.subject": "{app}: Deletion request for your account {account} on {when}",
  "inactivity.mail.warning.intro":
    "nobody has signed in to your {app} account {account} for a long time. If that does not change, we will request deletion of the account and all its data on {when}.",
  "inactivity.mail.warning.keep":
    "To keep the account, sign in or click the button. The period then starts over.",
  "inactivity.mail.warning.button": "Keep account",
  "inactivity.mail.warning.after":
    "Even after the deletion request you can cancel it in the account settings until the waiting period ends.",
};

registerMailTranslations("en", INACTIVITY_MAIL_EN);

export function formatInactivityMailDate(instant: Temporal.Instant): string {
  const zoned = instant.toZonedDateTimeISO("UTC");
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${zoned.year}-${pad(zoned.month)}-${pad(zoned.day)}`;
}
