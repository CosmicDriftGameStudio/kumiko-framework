// English copy of the letter-foundation feature, its LetterXpress provider and their audit labels.

export const letterEnCatalog: Readonly<Record<string, string>> = {
  "audit.log.event.letter-approved": "Letter approved",
  "audit.log.event.letter-submission-unknown": "Letter handover unconfirmed",
  "audit.log.event.letter-on-hold": "Letter on hold at the provider",
  "audit.log.event.letter-sent": "Letter sent",
  "audit.log.event.letter-failed": "Letter failed",
  "audit.log.event.letter-canceled": "Letter canceled",
  "audit.log.event.letter-returned": "Letter returned",
  "letter-foundation:write:approve:title": "Approve letter",
  "letter-foundation:write:approve:field:letterId": "Letter",
  "letter-foundation:write:approve-many:title": "Approve several letters",
  "letter-foundation:write:approve-many:field:letterIds": "Letters",
  "letter-foundation:write:cancel:title": "Cancel letter",
  "letter-foundation:write:cancel:field:letterId": "Letter",
  "letter-foundation:write:resolve-unknown:title": "Close unclear handover",
  "letter-foundation:write:resolve-unknown:field:letterId": "Letter",
  "letter-foundation:write:resolve-unknown:field:note": "Note",
  "letter-foundation:write:resolve-unknown:field:providerJobId": "Order number at the provider",
  "letter-foundation.errors.schriftformNotPossible":
    "This letter needs a handwritten signature. A printed letter cannot meet that form, so it cannot be sent this way.",
  "letter-foundation.errors.shippingModeUnsupported":
    "The print provider does not offer this shipping mode.",
  "letter-foundation.errors.envelopeUnsupported":
    "The print provider does not offer this envelope.",
  "letter-foundation.errors.tooManySheets":
    "The letter has more sheets than the print provider accepts.",
  "letter-foundation.errors.documentRejected":
    "The document cannot be sent as a letter. Check the page format (A4, portrait) and the file size.",
  "letter-foundation.errors.documentUnreadable":
    "A document of the letter cannot be read as a PDF.",
  "letter-foundation.errors.providerNotConfigured":
    "Letter sending is not configured on this server. Ask the operator to set the letter provider.",
  "letter-foundation.errors.noFiles": "The letter has no document.",
  "letter-foundation.errors.notAwaitingApproval": "The letter is not waiting for approval.",
  "screen:letter-foundation-tenant.title": "Letters",
  "screen:letter-foundation-system.title": "Letters",
  "letter-foundation.settings": "Letters",
  "letter-foundation.settings.live": "Live letter sending",
  "letter-provider-letterxpress.section": "LetterXpress access",
  "letter-provider-letterxpress.username-help":
    "User name of the LetterXpress account. Letters are only sent with it while live letter sending is on.",
  "letter-provider-letterxpress.api-key-help":
    "API key of the LetterXpress account. It is stored encrypted and never shown again; enter a new one to replace it.",
  "letter-provider-letterxpress.username": "LetterXpress user name",
  "letter-provider-letterxpress.api-key": "LetterXpress API key",
  "letter-foundation.settings.monthlyLimit": "Monthly letter sending budget per tenant",
  "letter-foundation.settings.monthlyLimitHelp":
    "Upper limit for the letter costs of one tenant per calendar month, net. Each letter counts with its full price at the print provider: printing, envelope, postage and, if chosen, registered mail. Approved letters not yet handed over already count. Once it is used up, no further letter is approved until the next month or a higher budget. 0 € means no letter is approved.",
  "letter-foundation.errors.notReadyForApproval":
    "Some of the selected letters are not ready for approval. A letter is ready when it waits for approval and its document was checked without a problem.",
  "letter-foundation.errors.monthlyLimitNotCovered":
    "The monthly limit does not cover this letter. The operator can raise the limit.",
  "letter-foundation.errors.notCancelableHere": "The letter can no longer be canceled.",
  "letter-foundation.errors.cancelAfterAcceptanceUnavailable":
    "The print provider already has this letter, so it cannot be canceled here.",
  "letter-foundation.errors.transitionNotAllowed": "The letter cannot change to this status.",
  "letter-foundation.errors.stateChanged":
    "The letter changed in the meantime. Reload it and try again.",
  "letter-foundation.errors.notSubmissionUnknown":
    "Only a letter whose handover is unconfirmed can be closed here.",
  "letter-foundation.errors.cancelWindowClosed":
    "The cancel window at the print provider has closed.",
  "letter-foundation.errors.cancelAlreadyProcessed":
    "The print provider has already processed the letter.",
  "letter-foundation.errors.cancelUnknownJob": "The print provider does not know this letter.",
  "letter-foundation.errors.providerJobMismatch":
    "The print provider has no order with this id for this letter.",
  "letter-foundation.errors.providerChanged":
    "This letter was approved with another provider. Switch back to that provider to change it.",
  "letter-foundation.preview.monthlyLimitExceeded":
    "The monthly letter cost limit does not cover this letter.",
};
