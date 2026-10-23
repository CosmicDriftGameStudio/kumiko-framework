---
"@cosmicdrift/kumiko-bundled-features": minor
---

The user/testing and tenant/testing subpaths export event-store write helpers for users, memberships and tenants.

<!-- kumiko-changes
feature: testing
type: feature
title: Event-store write helpers for user, membership and tenant tests
detail: The user/testing and tenant/testing subpaths export updateUserViaEventStore, softDeleteUserViaEventStore, setMembershipRolesViaEventStore, deleteMembershipViaEventStore and updateTenantViaEventStore. Tests use them to change event-sourced rows through the event store instead of the projection tables.
-->
