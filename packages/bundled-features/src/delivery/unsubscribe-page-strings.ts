import { registerMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";

// The pages behind a mailed unsubscribe link speak the mail's language, so their texts live in
// the mail translations: English here, other languages in the locale packages.
export const UNSUBSCRIBE_PAGE_EN = {
  "mail.unsubscribe.confirmTitle": "Unsubscribe",
  "mail.unsubscribe.confirmQuestion": "Unsubscribe from these emails?",
  "mail.unsubscribe.confirmButton": "Unsubscribe",
  "mail.unsubscribe.doneTitle": "Unsubscribed",
  "mail.unsubscribe.doneMessage": "You have been unsubscribed.",
  "mail.unsubscribe.undoButton": "Undo",
  "mail.unsubscribe.undoHint": "Unsubscribed by mistake? You can undo it within the next hour.",
  "mail.unsubscribe.resubscribedTitle": "Subscribed again",
  "mail.unsubscribe.resubscribedMessage": "You have been subscribed again.",
  "mail.unsubscribe.failed": "That did not work. Please try again later.",
  "mail.unsubscribe.failedTitle": "Something went wrong",
  "mail.unsubscribe.resubscribeLimitReached": "This address cannot be subscribed again here.",
  "mail.unsubscribe.invalidTitle": "Link no longer valid",
  "mail.unsubscribe.invalidMessage":
    "This link is invalid or has expired. Please use the unsubscribe link in a more recent email.",
} as const;

registerMailTranslations("en", UNSUBSCRIBE_PAGE_EN);
