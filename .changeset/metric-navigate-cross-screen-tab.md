---
"@cosmicdrift/kumiko-framework": patch
---

Boot validator now checks MetricNavigate's `tab` against the target screen's sections when `navigate` also sets `screen` or `entity`, not just for same-screen tab activation (fw#3260)

<!-- kumiko-changes
feature: framework
type: fix
title: Boot validator checks a metric's cross-screen navigate tab
detail: |
  A projectionDetail metric whose `navigate` sets `screen` or `entity` plus
  `tab` now fails boot when the target is not a projectionDetail with
  layout.mode "tabs" or has no section with that id. Previously only a
  same-screen `tab` was checked.
-->
