---
"@cosmicdrift/kumiko-testing": minor
---

`captureScreenshot(page, name)` for mid-flow E2E screenshots; `reducedMotion: "reduce"` is now the default (fw#3118)

<!-- kumiko-changes
feature: testing
type: breaking
title: reducedMotion defaults to "reduce" in runScreenshots/runMatrix/captureScreenshot; captureScreenshot(page, name) added
detail: |
  rAF-driven chart/tween animations were invisible to the settle-detection
  wait, so screenshots sometimes captured a mid-animation frame. Both matrix
  helpers, and the new captureScreenshot(page, name, opts?) helper, now call
  page.emulateMedia({ reducedMotion }) with "reduce" as the default before
  every capture (@playwright/test's PlaywrightTestOptions has no
  reducedMotion field in the pinned version, so this can't go through
  test.use()). captureScreenshot reuses the matrix runner's settle logic,
  writes $SCREENSHOT_DIR/<name>.png, and is a no-op when SCREENSHOT_DIR is
  unset — for solon's mid-flow shot(page, id) and offlot's inline
  page.screenshot writes into docs/screenshots/e2e/.
migration: |
  Pass `reducedMotion: "no-preference"` in runScreenshots/runMatrix's
  options, or as captureScreenshot's third argument, for a scenario that
  must keep real motion.
-->
