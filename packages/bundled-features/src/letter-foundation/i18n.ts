import { LetterI18n } from "./constants.ts";
import { LETTER_PROVIDER_NOT_CONFIGURED } from "./provider-resolver.ts";

export const LETTER_FOUNDATION_I18N = {
  "letter-foundation:write:approve:title": { en: "Approve letter" },
  "letter-foundation:write:approve:field:letterId": { en: "Letter" },
  "letter-foundation:write:approve-many:title": { en: "Approve several letters" },
  "letter-foundation:write:approve-many:field:letterIds": { en: "Letters" },
  "letter-foundation:write:cancel:title": { en: "Cancel letter" },
  "letter-foundation:write:cancel:field:letterId": { en: "Letter" },
  "letter-foundation:write:resolve-unknown:title": { en: "Close unclear handover" },
  "letter-foundation:write:resolve-unknown:field:letterId": { en: "Letter" },
  "letter-foundation:write:resolve-unknown:field:note": { en: "Note" },
  "letter-foundation:write:resolve-unknown:field:providerJobId": {
    en: "Order number at the provider",
  },
  [LetterI18n.schriftformRejected]: {
    en: "This letter needs a handwritten signature. A printed letter cannot meet that form, so it cannot be sent this way.",
  },
  [LetterI18n.shippingModeUnsupported]: {
    en: "The print provider does not offer this shipping mode.",
  },
  [LetterI18n.envelopeUnsupported]: {
    en: "The print provider does not offer this envelope.",
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
  [LETTER_PROVIDER_NOT_CONFIGURED.i18nKey]: {
    en: "Letter sending is not configured on this server. Ask the operator to set the letter provider.",
  },
  [LetterI18n.noFiles]: { en: "The letter has no document." },
  "screen:letter-foundation-tenant.title": { en: "Letters" },
  "screen:letter-foundation-system.title": { en: "Letters" },
  "letter-foundation.settings": { en: "Letters" },
  [LetterI18n.liveTitle]: { en: "Live letter sending" },
  [LetterI18n.monthlyLimitTitle]: { en: "Monthly letter budget per tenant" },
  [LetterI18n.monthlyLimitHelp]: {
    en: "Net amount the approved letters of one tenant may cost per calendar month, including approved letters not yet handed over. Once it is used up, no further letter is approved until the next month or a higher budget. 0 € means no letter is approved.",
  },
  [LetterI18n.notReadyForApproval]: {
    en: "Some of the selected letters are not ready for approval. A letter is ready when it waits for approval and its document was checked without a problem.",
  },
  [LetterI18n.notAwaitingApproval]: { en: "The letter is not waiting for approval." },
  [LetterI18n.monthlyLimitNotCovered]: {
    en: "The monthly limit does not cover this letter. The operator can raise the limit.",
  },
  [LetterI18n.notCancelableHere]: { en: "The letter can no longer be canceled." },
  [LetterI18n.cancelAfterAcceptanceUnavailable]: {
    en: "The print provider already has this letter, so it cannot be canceled here.",
  },
  [LetterI18n.transitionNotAllowed]: { en: "The letter cannot change to this status." },
  [LetterI18n.stateChanged]: {
    en: "The letter changed in the meantime. Reload it and try again.",
  },
  [LetterI18n.notSubmissionUnknown]: {
    en: "Only a letter whose handover is unconfirmed can be closed here.",
  },
  [LetterI18n.cancelWindowClosed]: { en: "The cancel window at the print provider has closed." },
  [LetterI18n.cancelAlreadyProcessed]: {
    en: "The print provider has already processed the letter.",
  },
  [LetterI18n.cancelUnknownJob]: { en: "The print provider does not know this letter." },
  [LetterI18n.providerJobMismatch]: {
    en: "The print provider has no order with this id for this letter.",
  },
  [LetterI18n.providerChanged]: {
    en: "This letter was approved with another provider. Switch back to that provider to change it.",
  },
  [LetterI18n.limitHint]: {
    en: "The monthly letter cost limit does not cover this letter.",
  },
} as const;
