---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Internal duplicates in framework and bundled-features are merged into shared modules. Behavior and public exports stay the same.

<!-- kumiko-changes
feature: framework
type: improvement
title: Engine and db helpers deduplicated
detail: The engine uses one findEntity lookup instead of three copies, the PII subject resolver and the boot validator use isFileField, insertOne builds its SQL through the same insert helpers as insertMany, the projection rebuild maps event rows through the shared toStoredEvent, and the app-schema role projection filters row, toolbar and related-list actions through one helper. No behavior change.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Bundled features share internal helpers
detail: Access resolution for folders, ledger, notes-history and tags, the folders/tags write hook, the system-mode TenantDb cache of the re-encryption and rotation jobs, the mail locale templates of auth-email-password and user-data-rights, extension option collection for delivery and renderers, PAT scope parsing, user-data-rights hook DBs, unique-constraint failure checks, tenant member PII decryption, the status banner, the invite-accept request, the tenant label and the jobs subject parser each live in one internal module now. Empty onRegister callbacks are dropped. No behavior change.
-->
