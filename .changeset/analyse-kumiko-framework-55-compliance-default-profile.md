---
"@cosmicdrift/kumiko-bundled-features": patch
---

`createComplianceProfilesFeature({ defaultProfile })` gives every new tenant a compliance profile in the transaction that creates it.

<!-- kumiko-changes
feature: compliance-profiles
type: improvement
title: Default compliance profile on tenant creation
detail: The option takes a selectable profile key (`eu-dsgvo`, `swiss-dsg`, `de-hr-dsgvo-hgb`) and writes it as the tenant's profile through the event-store executor when a tenant is created; with the option the feature requires `tenant`. The `for-tenant` query, `needs-profile`, data retention and the export jobs all read that row, and a tenant admin can still change it with `set-profile`. The default tier of tier-engine and the default profile share one tenant-created hook: the default tier assignment is now recorded with the system user, and a missing `ctx.systemDb` fails the tenant creation instead of silently skipping the default.
-->
