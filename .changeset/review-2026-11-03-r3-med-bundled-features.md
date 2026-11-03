---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Review round 3 for bundled features: missing inline images no longer fail a mail, a pending in-app plan switch blocks a second one, a disconnected personal mailbox no longer locks an address for a shared one, and the preset `access.authenticated` is renamed to `access.builtinUserRoles`.

<!-- kumiko-changes
feature: framework
type: breaking
title: access.authenticated is renamed to access.builtinUserRoles
detail: The preset only lists the built-in roles User, Admin and SystemAdmin, so a member who holds only an app-defined role was refused although signed in. The new name says what it covers; for "any signed-in user" use `anySignedIn: true` or `openToAll`.
migration: Replace `access.authenticated` by `access.builtinUserRoles`; where every signed-in user must pass, use `anySignedIn: true` instead.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: file providers throw FileObjectMissingError for a missing object; header scrub for stored events
detail: The in-memory, local and S3 file providers throw `FileObjectMissingError` (exported from `@cosmicdrift/kumiko-framework/files`) when the stored object is gone. New operator helper `scrubEventHeaderKeys` removes chosen keys (for example `rawPayload`) from the headers of stored events of given types, with a reason and a dry run; it is not run automatically.
-->

<!-- kumiko-changes
feature: bundled-features
type: fix
title: mail and billing robustness fixes
detail: An inline mail image whose stored object is gone is skipped instead of failing the mail. A final step-delivery attempt whose outcome cannot be recorded still erases the dispatch key. A second in-app plan switch is refused until the provider's webhook confirmed the first one (30 minute window). An admin can connect a shared mailbox on an address held by a member's disconnected personal mailbox. The IMAP sent-folder copy is appended detached, and the docs say to call `sendMailFromAccount` from `beforeTransaction`.
-->
