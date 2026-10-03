---
"@cosmicdrift/kumiko-renderer-web": patch
---

`Field layout="inline"` labels wrap instead of truncating. A long label next to a checkbox (the checkout consent texts) no longer widens its container past the viewport, which pushed the dialog's action buttons out of reach.

<!-- kumiko-changes
feature: renderer-web
type: fix
title: Inline field labels wrap instead of truncating
detail: |
  `Field layout="inline"` no longer puts its label in a single truncated line. Long checkbox labels such as the checkout consent texts wrap, so the dialog stays inside the viewport and its buttons stay reachable.
migration: |
  keine
-->
