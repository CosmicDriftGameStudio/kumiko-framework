---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Final review batch E2: bundled features

The login screen, the MFA verify screen and the MFA preauth setup screen now follow the server's `landingPath` after a successful sign-in when there is no validated `next` parameter; `AuthGate` forwards it through `onSuccess(landingPath)`. Self-signup and invite-signup store the locale of the registering request on the new user and in the session. `inbound-provider-imap` declares the same `MAIL_ALLOWED_PRIVATE_HOSTS` env schema as `mail-transport-smtp`, so an IMAP-only app can allow private hosts, and `composeEnvSchema` accepts the same field instance from several features. Row-bound grants refuse a `:` in anchor or subject, because the signed input is joined with `:`. Ledger schedules with only one of `subjectType` and `subjectId` are rejected. `notes-history` indexes `read_note_mentions` by `(tenant_id, subject_id)`, and `store_tenant_job_failures` gets three indexes; `jobs:query:failures` lists only the newest record per job and subject. `user:query:user:list` skips the tenants label when the tenant feature is not mounted. `template-resolver:query:list` filters by every template kind, including `text-block` and `ai-prompt`. `BillingInfo.prices` is keyed by the tier union.

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: Login, MFA verify and MFA preauth setup follow the server landingPath when no valid next parameter is present
detail: AuthGate onSuccess receives the landing path. A validated next parameter still wins; a landing path equal to the current path is not followed, so the screen does not reload itself.
-->

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: Signup-confirm and invite-signup-complete store the request locale on the new user and in the session
-->

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: INITIAL_SIGNUP_ROLES stays ["TenantAdmin", "Admin"] as a transition
detail: New self-signup owners hold TenantAdmin plus the legacy Admin literal, because handlers that gate on the Admin literal would otherwise lock them out. Both roles show in Team, Members until those handlers gate on access.admin. This supersedes the earlier note that the owner role is only TenantAdmin.
migration: Move your own handlers that gate on the Admin literal to access.admin; after that the Admin entry can be dropped from the constant.
-->

<!-- kumiko-changes
feature: inbound-provider-imap
type: fix
title: inbound-provider-imap declares the MAIL_ALLOWED_PRIVATE_HOSTS env schema
migration: No action needed. An app that mounts both mail-transport-smtp and inbound-provider-imap now composes one shared field.
-->

<!-- kumiko-changes
feature: user-data-rights
type: breaking
title: Row-bound grants (deletion token, tenant handover) refuse a colon in anchor or subject
migration: signRowBoundGrant now throws when the anchor or subject contains ":", and redeem returns FAILED for such a token. Use colon-free ids (uuids) for anchor and subject; a purpose may still contain a colon.
-->

<!-- kumiko-changes
feature: ledger
type: breaking
title: A ledger schedule needs subjectType and subjectId together or neither
migration: Create and update schedule calls that set only one of the two fields now fail validation. Send both fields or neither.
-->

<!-- kumiko-changes
feature: notes-history
type: fix
title: read_note_mentions gets a tenant, subject index
migration: Run `kumiko schema generate`; it emits an in-place CREATE INDEX with no DROP and no rebuild.
-->

<!-- kumiko-changes
feature: jobs
type: fix
title: store_tenant_job_failures gets three indexes and jobs:query:failures lists one record per job and subject
migration: Run `kumiko schema generate`; it emits in-place CREATE INDEX statements with no DROP and no rebuild.
-->

<!-- kumiko-changes
feature: user
type: fix
title: user:query:user:list skips the tenants label when the tenant feature is not mounted
-->

<!-- kumiko-changes
feature: template-resolver
type: fix
title: template-resolver list filters by every template kind including text-block and ai-prompt
-->

<!-- kumiko-changes
feature: billing-foundation
type: breaking
title: BillingInfo.prices and getBillingPrices are keyed by the tier union
migration: A getBillingPrices that returns keys outside your tier union no longer compiles; remove or rename those keys.
-->
