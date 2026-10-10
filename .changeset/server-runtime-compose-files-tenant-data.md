---
"@cosmicdrift/kumiko-server-runtime": minor
---

composeFeatures mounts files-tenant-data when files and tenant-lifecycle are present

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: composeFeatures mounts files-tenant-data when files and tenant-lifecycle are present
-->

In `includeBundled` apps that mount both `files` and `tenant-lifecycle`, `composeFeatures` now appends `files-tenant-data` automatically. Tenant destroy therefore deletes the tenant's `fileRef` rows and stored file binaries, which it previously left behind with only a boot warning. Apps that already mount `files-tenant-data` themselves are unchanged, and `includeBundled: false` keeps the warning.
