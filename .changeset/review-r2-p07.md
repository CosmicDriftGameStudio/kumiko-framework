---
"@cosmicdrift/kumiko-bundled-features": patch
---

Review fixes for template-resolver: the layout usage list sees the same rows as the overview, admin views apply the same delivery rule as rendering, archiving drops an open draft, seeded title keys are format-checked, and a failing rollback no longer hides the upload error.

<!-- kumiko-changes
feature: template-resolver
type: fix
title: Layout usage list matches the overview
detail: The usage query of a mail layout filters the mail rows by the caller's visibility like the overview and logs a warning when the 5000-row limit cuts the result.
-->

<!-- kumiko-changes
feature: template-resolver
type: fix
title: Admin views follow the delivery rule of rendering
detail: List, find-by-id, diff-to-system, validate, preview and the document base hide a collection row that a locked system template of the same slug shadows, as mail, PDF and the resolver already do.
-->

<!-- kumiko-changes
feature: template-resolver
type: fix
title: Archiving drops an open draft
detail: A draft only lives beside an active version, so archive clears it; the editor shows the archived status and publish brings back the archived version instead of the draft.
-->

<!-- kumiko-changes
feature: template-resolver
type: fix
title: Seeded title key must look like a namespace:key
detail: seedSystemTemplate rejects a titleI18nKey without a namespace prefix or with whitespace, so free text cannot pass as a key and show up raw in the UI.
-->

<!-- kumiko-changes
feature: template-resolver
type: fix
title: Failing release keeps the upload error
detail: When releasing already uploaded files fails after a refused upload in copy-locale or bundle import, the release error is logged and the original error is returned, and the releases run once.
-->
