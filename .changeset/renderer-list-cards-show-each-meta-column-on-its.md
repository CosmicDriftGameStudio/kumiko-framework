---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

List card meta values wrap instead of being clipped; more than 3 meta columns fail boot

<!-- kumiko-changes
feature: renderer
type: breaking
title: List card meta values wrap instead of being clipped; more than 3 meta columns fail boot
migration: |
  Narrow list cards (entityList, projectionList, relatedList sections, expandableRow) now render meta values as a dot-separated row that wraps onto further lines instead of being cut off after two lines (and no longer subject to a silent runtime cap of 3 values); only a single value wider than the card is truncated. Meta columns are all columns except the title (first column), the status select and columns with hideOnNarrow: true. validateBoot now rejects a list with more than 3 meta columns and names feature, screen, section and fields. Fix: mark the extra columns hideOnNarrow: true (tables keep them) or drop them. collectCardMetaOverflow(features) from @cosmicdrift/kumiko-framework/engine lists all offenders at once. headless now also honors hideOnNarrow on reference, derived, row-meta and renderer-only columns, which it previously ignored there.
-->
