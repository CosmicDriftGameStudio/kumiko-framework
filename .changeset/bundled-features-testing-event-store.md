---
"@cosmicdrift/kumiko-bundled-features": minor
---

The user/testing and tenant/testing subpaths export event-store write helpers for users, memberships and tenants and now load under Bun only.

<!-- kumiko-changes
feature: tenant
type: improvement
title: Event-store write helpers for user, membership and tenant tests
detail: The user/testing and tenant/testing subpaths export updateUserViaEventStore, softDeleteUserViaEventStore, setMembershipRolesViaEventStore, deleteMembershipViaEventStore and updateTenantViaEventStore. updateTenantViaEventStore addresses the stream of the seed SystemAdmin's tenant by default, where tenants created in tests live. Tests use them to change event-sourced rows through the event store instead of the projection tables. Both subpaths now import @cosmicdrift/kumiko-testing and therefore load under Bun only, like tenant-lifecycle/testing; import user/seeding or tenant/seeding where Node has to load the seed helpers.
-->
