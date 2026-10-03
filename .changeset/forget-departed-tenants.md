---
"@cosmicdrift/kumiko-bundled-features": patch
---

The forget run now also reaches tenants the user already left. `runForgetCleanup` used to run the user-data delete hooks only in tenants where the user was still a member, so a note mentioning the user in a tenant they had left stayed readable. It now takes the tenants from the live memberships plus the `tenant-membership.created` events for that user, runs each tenant once, and only falls back to the orphan pseudo-tenant when both are empty.

<!-- kumiko-changes
feature: user-data-rights
type: fix
title: Forget cleanup covers tenants the user already left
detail: |
  `runForgetCleanup` builds the per-user tenant list from live memberships plus the user's `tenant-membership.created` history (read from the event payload, so cross-tenant SystemAdmin adds count too), deduplicated. Delete hooks, such as the notes-history mention shred, therefore also run in tenants the user left before the request. The `tenantIdsBeforeDelete` list passed to the deletion-executed mail still contains only the live memberships. Mentions written before notes recorded structured mention rows for non-members are not covered.
-->
