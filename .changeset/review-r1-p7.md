---
"@cosmicdrift/kumiko-bundled-features": patch
---

Ingest progress no longer fails under heavy parallel reports, helpdesk forwarding runs without the delivery feature, legacy contact lookups skip archived and foreign requests before decrypting, the email normalization has one source, and the opted-in-user-ids query refuses the wildcard type.

<!-- kumiko-changes
feature: document-ingest-foundation
type: fix
title: Parallel ingest progress reports no longer fail after the retry budget
detail: A version conflict after the last attempt means a newer report already landed, so reportIngestProgress returns instead of throwing into the ingest run.
-->

<!-- kumiko-changes
feature: helpdesk
type: fix
title: Helpdesk forwards requests and replies without ctx.notify
detail: Forwarding a request, the reply mail dispatch and the in-app note are plain dispatches and now run through runBestEffort instead of the notify-gated sendBestEffort, so they no longer get skipped when the delivery feature is not mounted. The legacy contact subject lookup checks the archive first and decrypts an email only for anonymous requests.
-->

<!-- kumiko-changes
feature: delivery
type: fix
title: opted-in-user-ids refuses the wildcard type and resolves former names
detail: A notificationType of "*" is rejected by the schema so wildcard rows never count as opt-in, and a former notification name resolves to the current type instead of returning an empty list.
-->

<!-- kumiko-changes
feature: shared
type: fix
title: One normalizeEmail for helpdesk, waitlist, signup tokens and user-data lookups
detail: The copies in helpdesk, waitlist, signup-token-store and the inline toLowerCase in resolveVerifiedUserEmail now use shared/normalizeEmail, so a changed normalization cannot make export and erasure miss stored rows.
-->
