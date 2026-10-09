---
"@cosmicdrift/kumiko-bundled-features": minor
---

Boot warns when files is mounted without files-tenant-data

files-tenant-data is opt-in, so an app with tenant-lifecycle and files that forgot it silently left fileRef rows and stored binaries behind on tenant destroy. tenant-lifecycle now logs a boot warning in that case. Action: mount createFilesTenantDataFeature(), or ignore the warning if the app erases files itself.

<!-- kumiko-changes
feature: tenant-lifecycle
type: improvement
title: Boot warns when files is mounted without files-tenant-data
-->
