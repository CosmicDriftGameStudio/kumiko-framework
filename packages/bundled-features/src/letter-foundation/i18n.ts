import { LetterI18n } from "./constants.ts";

export const LETTER_FOUNDATION_I18N = {
  [LetterI18n.schriftformRejected]: {
    en: "This letter needs a handwritten signature. A printed letter cannot meet that form, so it cannot be sent this way.",
  },
  [LetterI18n.shippingModeUnsupported]: {
    en: "The print provider does not offer this shipping mode.",
  },
  [LetterI18n.tooManySheets]: {
    en: "The letter has more sheets than the print provider accepts.",
  },
  [LetterI18n.documentRejected]: {
    en: "The document cannot be sent as a letter. Check the page format (A4, portrait) and the file size.",
  },
  [LetterI18n.documentUnreadable]: {
    en: "A document of the letter cannot be read as a PDF.",
  },
  [LetterI18n.noFiles]: { en: "The letter has no document." },
  [LetterI18n.notAwaitingApproval]: { en: "The letter is not waiting for approval." },
  [LetterI18n.notCancelableHere]: { en: "The letter can no longer be canceled." },
  [LetterI18n.cancelAfterAcceptanceUnavailable]: {
    en: "The print provider already has this letter, so it cannot be canceled here.",
  },
  [LetterI18n.transitionNotAllowed]: { en: "The letter cannot change to this status." },
  [LetterI18n.stateChanged]: {
    en: "The letter changed in the meantime. Reload it and try again.",
  },
  [LetterI18n.limitHint]: {
    en: "The monthly letter cost limit does not cover this letter.",
  },
} as const;
