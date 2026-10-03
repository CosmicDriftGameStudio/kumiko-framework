---
"@cosmicdrift/kumiko-bundled-features": minor
---

With `consumerProtection` set, `billing-foundation` sends the buyer a contract confirmation mail once the contract is live. Event-triggered jobs on `subscription-created`, `subscription-updated`, `invoice-paid` and `payment-received` pick up events that carry the `consentId` of a recorded checkout consent (subscription events only while `active` or `trialing`) and call the system-only `issue-contract-confirmation` handler. The mail repeats the plan, price, contract start and current period end, the VAT note, the confirmed consent texts with the time of consent, and the full terms text block in the consent language. A `contract-confirmation-issued` event is appended before the mail is handed to delivery, so a webhook replay, a second qualifying event or a concurrent run cannot send a second mail.

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: Contract confirmation mail after a recorded checkout consent
detail: |
  With `consumerProtection`, four event-triggered jobs (`confirm-on-subscription-created`, `confirm-on-subscription-updated`, `confirm-on-invoice-paid`, `confirm-on-payment-received`) call the system-only `billing-foundation:write:issue-contract-confirmation` (`consentId`, `sourceAggregateId`, optional `currentPeriodEndIso`) for events carrying a `consentId`; subscription events only count with status `active` or `trialing`. The handler only reads the caller tenant's own subscription or payment stream, finds the `checkout-consent-recorded` event, appends `contract-confirmation-issued` (`consentId`, `issuedAtIso`, `locale`, `termsTemplateVersion`) at the fetched stream version and then notifies `billing-foundation:contract-confirmation` (critical priority) to the consenting user's email. A second run returns `{ issued: false, reason: "already_issued" }` or fails with a version conflict; an unknown consent returns `consent_not_found` and sends nothing. The mail is rendered in German or English (fallback German) as structured header/sections content for the email channel's renderer.
migration: |
  Enabling `consumerProtection` additionally requires the `user` feature, and an email channel plus renderer must be mounted for the mail to go out.
-->
