---
"@cosmicdrift/kumiko-testing": patch
---

defineAppE2eConfig fails fast with a clear message when a dedicated screenshots config runs without SCREENSHOT_DIR

<!-- kumiko-changes
feature: testing
type: fix
title: A dedicated screenshots Playwright config without SCREENSHOT_DIR now fails with a clear message
detail: |
  A dedicated screenshots config (testDir: "./e2e/screenshots", used by
  phronexsis and publicstatus) had its entire testDir excluded by
  screenshotSpecsIgnore()'s "**/screenshots/**" pattern whenever
  SCREENSHOT_DIR was unset, so Playwright reported the generic "No tests
  found" with no mention of the missing env var — even though
  requireScreenshotDir() already existed with a clear message, just never
  called on this path. defineAppE2eConfig now calls it up front for any
  testDir ending in "screenshots" outside a screenshot run.
-->
