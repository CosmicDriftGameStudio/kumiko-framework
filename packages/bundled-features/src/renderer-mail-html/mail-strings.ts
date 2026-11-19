import { mailT, registerMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";

// English ships here; other languages come from the locale packages, and an
// unknown locale falls back through its root language to English (mailT).
export const MAIL_CHROME_EN = {
  "mail.footer.sentBy": "Sent by {sender}",
  "mail.footer.unsubscribe": "Unsubscribe",
  "mail.footer.imprint": "Imprint",
  "mail.footer.privacy": "Privacy policy",
} as const;

registerMailTranslations("en", MAIL_CHROME_EN);

export type MailChromeKey = keyof typeof MAIL_CHROME_EN;

export function mailChromeText(
  locale: string,
  key: MailChromeKey,
  params?: Readonly<Record<string, string>>,
): string {
  return mailT(locale, key, params);
}
