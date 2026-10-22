---
"@cosmicdrift/kumiko-bundled-features": patch
---

Template seeding no longer undoes admin decisions, and copy-locale rejects a source that changed during the upload.

<!-- kumiko-changes
feature: template-resolver
type: fix
title: Re-seeding keeps archived system templates, drops stale drafts and adds only missing bundle locales
detail: A boot-time re-seed no longer reactivates an archived system template and clears an open system draft when the seeded content changes. A bundle with resources seeded with ifExists skip imports only the missing locales instead of overwriting existing system rows. copy-locale fails with version_conflict when its source changed between the upload and the transaction, and releases the uploaded files.
-->
