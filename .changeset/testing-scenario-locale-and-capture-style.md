---
"@cosmicdrift/kumiko-testing": minor
---

Screenshot scenarios get the matrix locale in `flow` and a screenshot-only `captureStyle` (fw#3118)

<!-- kumiko-changes
feature: testing
type: improvement
title: Scenario flow receives runMatrix's locale; Scenario.captureStyle for screenshot-only CSS
detail: |
  runMatrix passes the current locale to `flow(page, { seedTenant, locale })`,
  so apps whose routes carry the locale in the path (offlot's public vehicle
  page) can build the URL per locale. `captureStyle` is handed to Playwright's
  screenshot `style` option in runScreenshots and runMatrix: the CSS applies
  to the capture only and does not leak into the next theme × viewport shot.
  A scenario's `waitFor` now uses the template budget (`E2E_TIMEOUT_MS.navigation`,
  or `E2E_TIMEOUT_MS.real` under KUMIKO_REAL_PROVIDERS=1) instead of a fixed 10s.
-->
