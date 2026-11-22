// English copy of the letter-foundation feature.

export const letterEnCatalog: Readonly<Record<string, string>> = {
  "letter-foundation.errors.schriftformNotPossible":
    "This letter needs a handwritten signature. A printed letter cannot meet that form, so it cannot be sent this way.",
  "letter-foundation.errors.shippingModeUnsupported":
    "The print provider does not offer this shipping mode.",
  "letter-foundation.errors.tooManySheets":
    "The letter has more sheets than the print provider accepts.",
  "letter-foundation.errors.documentRejected":
    "The document cannot be sent as a letter. Check the page format (A4, portrait) and the file size.",
  "letter-foundation.errors.documentUnreadable":
    "A document of the letter cannot be read as a PDF.",
  "letter-foundation.errors.noFiles": "The letter has no document.",
  "letter-foundation.errors.notAwaitingApproval": "The letter is not waiting for approval.",
  "letter-foundation.errors.notCancelableHere": "The letter can no longer be canceled.",
  "letter-foundation.errors.cancelAfterAcceptanceUnavailable":
    "The print provider already has this letter, so it cannot be canceled here.",
  "letter-foundation.errors.transitionNotAllowed": "The letter cannot change to this status.",
  "letter-foundation.errors.stateChanged":
    "The letter changed in the meantime. Reload it and try again.",
  "letter-foundation.preview.monthlyLimitExceeded":
    "The monthly letter cost limit does not cover this letter.",
};
