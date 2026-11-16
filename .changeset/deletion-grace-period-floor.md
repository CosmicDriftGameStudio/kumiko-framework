---
"@cosmicdrift/kumiko-bundled-features": minor
---

Account deletion now waits the longest grace period of all the user's tenants, and never less than 7 days.

<!-- kumiko-changes
feature: user-data-rights
type: breaking
title: Deletion grace period is the maximum over the user's tenants with a 7-day floor
detail: `request-deletion` and `confirm-deletion-by-token` took the grace period from the active tenant's compliance profile, although the deletion hits the global user. A tenant admin could set it to 0 days via `compliance-profiles:write:set-profile`. The period is now the longest `userRights.gracePeriod` over every tenant the user is a member of (the active tenant for a user without memberships), raised to `MIN_DELETION_GRACE_PERIOD` (7 days) if shorter and capped at `MAX_DELETION_GRACE_PERIOD` (90 days) if longer, so one tenant profile cannot postpone a global deletion indefinitely. The handlers read `read_tenant_memberships`, so an app stack that mounts user-data-rights needs the tenant feature's membership table.
migration: Apps that relied on a grace period shorter than 7 days (for example `{ hours: 6 }` overrides) now get 7 days; longer values (for example 3650 days) now get 90 days. Test stacks that mount user-data-rights and call these handlers must create the membership table (`unsafeCreateEntityTable(db, tenantMembershipEntity)`).
-->
