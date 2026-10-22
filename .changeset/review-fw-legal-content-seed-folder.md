---
"@cosmicdrift/kumiko-bundled-features": minor
---

`legalContentSeed(source, { folder })` and `seedLegalContentFromJson(db, blocks, { folder })` put the seeded text blocks into a content-tree folder. A re-seed without a folder option now keeps the folder an existing block already has, instead of resetting it to the root on every boot. `seedTextBlock` with `ifExists: "update"` now keeps an existing folder whenever `folder` is omitted; clearing it needs an explicit `folder: null`.

<!-- kumiko-changes
feature: template-resolver
type: fix
title: legalContentSeed keeps and can set the content folder
detail: seedTextBlock no longer resets the folder of an existing block to null when the seed passes no folder. legalContentSeed takes an optional folder, so apps do not need their own seed loop to keep legal blocks in the SystemAdmin content tree.
-->
