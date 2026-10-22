---
"@cosmicdrift/kumiko-bundled-features": patch
---

`purgeFilesReachingSubject` reads the candidate rows of a user subject in id-ordered pages instead of loading every row the user owns at once. Failures were already collected per row and thrown at the end; that stays.

<!-- kumiko-changes
feature: crypto-shredding
type: improvement
title: The subject file purge reads candidate rows in pages
detail: A user owning many records no longer loads them all into memory at once; every page is purged, not only the first.
-->
