---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-headless": patch
---

`createLegalPagesFeature` now throws when custom `routes` cover no default required block and `requiredBlocks` is omitted, instead of failing the production boot check later. The text-block and system-template seed race loser now honours `ifExists: "skip"` and the no-op comparison. `SegmentedSelect` keeps the first segment tabbable when the stored value matches no option. The `subscribePathname` option documents that the `popstate` default misses `pushState` navigation.

<!-- kumiko-changes
feature: legal-pages
type: fix
title: Legal pages fail fast on custom routes without required blocks; seed race honours skip
-->
