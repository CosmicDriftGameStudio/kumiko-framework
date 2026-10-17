---
"@cosmicdrift/kumiko-document-designer": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

The document designer names seeded mails, opens in the UI language and shows the built-in layout

<!-- kumiko-changes
feature: document-designer
type: improvement
title: Seeded mails show readable titles and the editor opens in the UI language
detail: A mail template without a stored title is named by its notification label (<feature>:notify.<name>.label) in the overview and the editor header instead of its slug. The mail editor opens on the UI language, or its base language, when the template has it, and falls back to the previous choice otherwise. The layout select offers the built-in standard layout when no default layout is stored, and the preview text field shows a hint while empty.
-->

<!-- kumiko-changes
feature: auth-email-password
type: improvement
title: Auth mails carry designer labels
detail: The feature registers <feature>:feature.label and notify labels for password-reset, account-unlock, email-verification, signup-activation and invite, so the document designer lists them by name. German and Spanish ship in the locale packages.
-->

<!-- kumiko-changes
feature: user-data-rights
type: improvement
title: GDPR mails carry designer labels
detail: Feature and notify labels for export-ready, export-failed, deletion-requested and deletion-executed name the GDPR mails in the document designer.
-->

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: Contract mails carry designer labels
detail: Feature and notify labels for contract-confirmation, contract-termination-receipt and contract-termination-operator-notice name the contract mails in the document designer.
-->

<!-- kumiko-changes
feature: waitlist
type: improvement
title: Waitlist mails carry designer labels
detail: Feature and notify labels for confirmation and admin-notice name the waitlist mails in the document designer.
-->
