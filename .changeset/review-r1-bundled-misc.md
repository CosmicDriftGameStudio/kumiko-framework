---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
---

Review fixes: tenant destroy sweep keeps a minimum slice per tenant, inbound-mail polling skips any account whose address fails to decrypt, the delivery preferences query reports renamed notification types under their current name, and a deduplicated job add no longer resets a finished tenant run row.

<!-- kumiko-changes
feature: tenant-lifecycle
type: fix
title: Destroy sweep keeps a minimum time slice per tenant
detail: With many tenants in destroying state the shared tick budget no longer shrinks a tenant's slice below two seconds, so chunking hooks make progress instead of failing the stage as no-progress attempts.
-->

<!-- kumiko-changes
feature: inbound-mail-foundation
type: fix
title: Undecryptable mail account no longer stops polling of other accounts
detail: Any decryption failure of an account address (corrupt envelope, missing key, AAD mismatch) is logged by error class and the account is skipped; the other accounts keep polling.
-->

<!-- kumiko-changes
feature: delivery
type: fix
title: Preferences query reports renamed notification types under the current name
detail: Rows stored under a former notification name are returned with the current name and collapsed per channel with the delivery precedence (current-name row wins, otherwise any disabled row disables), so settings screens show the effective state.
-->

<!-- kumiko-changes
feature: jobs
type: fix
title: Deduplicated job add keeps the finished tenant run row
detail: JobQueuedMeta carries the BullMQ creation time of the job. The queued hook only removes finished rows queued before that time (leftovers of a Redis reset), so re-announcing an already finished job no longer turns its row back into queued.
-->
