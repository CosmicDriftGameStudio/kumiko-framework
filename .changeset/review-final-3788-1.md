---
"@cosmicdrift/kumiko-bundled-features": patch
---

The tenant-destroy `subject-keys` stage no longer erases the user key of a member who still belongs to another tenant that is not destroyed. Before, it tombstoned the key of every member, so a user who also belonged to a live tenant got `subject_erased` on every later PII write there.

<!-- kumiko-changes
feature: tenant-lifecycle
type: fix
title: Tenant destroy keeps user keys of members in other live tenants
detail: The subject-keys stage erases user keys only for members without a membership in another tenant whose status is not destroyed. The tenant and tenant-record keys are erased as before.
-->
