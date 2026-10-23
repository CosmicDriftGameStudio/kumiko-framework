---
"@cosmicdrift/kumiko-bundled-features": minor
---

The user/testing and tenant/testing subpaths export event-store write helpers for users, memberships and tenants.

<!-- kumiko-changes
feature: tenant
type: improvement
title: Event-store write helpers for user, membership and tenant tests
detail: The user/testing and tenant/testing subpaths export updateUserViaEventStore, softDeleteUserViaEventStore, setMembershipRolesViaEventStore, deleteMembershipViaEventStore and updateTenantViaEventStore. updateTenantViaEventStore addresses the stream of the seed SystemAdmin's tenant by default, where tenants created in tests live. Tests use them to change event-sourced rows through the event store instead of the projection tables.
-->
