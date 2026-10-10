---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

List cards show each meta column on its own line; more than 3 meta columns fail boot

<!-- kumiko-changes
feature: renderer
type: breaking
title: List cards show each meta column on its own line; more than 3 meta columns fail boot
migration: |
  Narrow list cards (entityList, projectionList, relatedList sections, expandableRow) now render every meta column on its own single-line row that truncates only itself, instead of one dot-joined line clamped to two lines plus a silent runtime cap of 3 values. Meta columns are all columns except the title (first column), the status select and columns with hideOnNarrow: true. validateBoot now rejects a list with more than 3 meta columns and names feature, screen, section and fields. Fix: mark the extra columns hideOnNarrow: true (tables keep them) or drop them. collectCardMetaOverflow(features) from @cosmicdrift/kumiko-framework/engine lists all offenders at once.
-->
