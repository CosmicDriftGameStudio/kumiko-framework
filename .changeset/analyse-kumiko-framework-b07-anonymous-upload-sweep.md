---
"@cosmicdrift/kumiko-framework": patch
---

Anonymous uploads that are never bound are removed after 24 hours.

<!-- kumiko-changes
feature: framework
type: improvement
title: Unbound anonymous uploads expire by default
detail: The files maintenance job now soft-deletes pending uploads of anonymous visitors (`anonymousUpload: true` fields) that no record bound within `createFilesFeature({ anonymousUploadGraceHours })`, default 24 hours. Pending uploads of signed-in users still follow the opt-in `pendingUploadGraceHours`.
-->
