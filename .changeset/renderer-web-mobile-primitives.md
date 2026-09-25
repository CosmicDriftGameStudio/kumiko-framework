---
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

Four mobile-viewport (390px) fixes: tab-strip overflow, sticky wizard footer, facet-reset i18n, segmented-select placeholder/borders

<!-- kumiko-changes
feature: renderer-web
type: fix
title: DefaultTabs shows an edge fade and keeps the active tab scrolled into view when the strip overflows on narrow viewports
detail: |
  At 390px, a tab strip with more tabs than fit gave no visible hint that
  it scrolled, and the active tab could end up scrolled out of view with
  no way to tell. The scroller now renders a mask-image edge fade on
  whichever side is scrollable (updated on scroll/resize via a guarded
  ResizeObserver), and scrolls the active trigger into view via
  `scrollLeft` — not `scrollIntoView`, which would also scroll the page
  vertically — on mount and on every activeId change.
-->

<!-- kumiko-changes
feature: renderer-web
type: fix
title: Wizard form footer on mobile now only pins the primary action, not Back/Cancel
detail: |
  Below 640px, DefaultForm's stickyActions pinned the whole footer
  (Back, Next/Submit, and secondaryActions like Cancel) to the viewport
  bottom together. Only the actual submit-type action needs that
  treatment (fw#1918: stay reachable above a virtual keyboard) — Back and
  secondaryActions now render in normal document flow alongside each
  other, while the primary action keeps its own `max-sm:fixed` bar.
  Desktop (sm+) layout is unchanged.
-->

<!-- kumiko-changes
feature: renderer-web
type: fix
title: DataTable's facet-reset button is now translatable ("Reset")
detail: |
  The facet-filter Reset button rendered a hardcoded English "Reset"
  regardless of locale. It now resolves kumiko.list.filter.reset (falling
  back to "Reset"), with German ("Zurücksetzen") and Spanish
  ("Restablecer") translations added to locale-de/locale-es.
-->

<!-- kumiko-changes
feature: renderer-web
type: fix
title: Select-as-SegmentedSelect excludes the placeholder option and fixes borders on wrapped segments
detail: |
  A `""`-value placeholder option counted toward the ≤4-option segmented-
  control threshold and rendered as its own (permanently unchecked)
  segment — it's now filtered out of both the eligibility count and the
  rendered segments, consistently for the radio-group and dropdown
  fallback. Separately, the container's `divide-x` only drew vertical
  borders between siblings in source order, which misplaced borders once
  segments wrapped to a second row (a stray left border, no line between
  rows); each segment now carries its own collapsing top/left border
  instead, correct for any wrap arrangement.
-->
