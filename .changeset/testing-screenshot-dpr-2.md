---
"@cosmicdrift/kumiko-testing": minor
---

Screenshot runs render at deviceScaleFactor 2 (fw#3118)

<!-- kumiko-changes
feature: testing
type: breaking
title: defineAppE2eConfig's chromium project renders screenshot runs at deviceScaleFactor 2
detail: |
  With SCREENSHOT_DIR set, the chromium project renders at 2x so runMatrix and
  captureScreenshot images stay sharp on HiDPI displays (desktop files are
  3840×2160). Plain e2e runs stay at 1x. Device projects keep their own scale.
migration: |
  Drop app-level deviceScaleFactor overrides (test.use or project use).
  Committed screenshots taken in the chromium project regenerate at 2x.
-->
