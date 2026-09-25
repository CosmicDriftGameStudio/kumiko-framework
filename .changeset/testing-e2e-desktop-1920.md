---
"@cosmicdrift/kumiko-testing": minor
---

E2E default viewport is 1920×1080 (fw#3118)

<!-- kumiko-changes
feature: testing
type: breaking
title: defineAppE2eConfig's chromium project runs at 1920×1080 instead of Desktop Chrome's 1280×720
detail: |
  The template took Playwright's "Desktop Chrome" device unchanged, so every
  e2e run and every inline captureScreenshot rendered at 1280×720 while
  runMatrix's desktop screenshots used 1920×1080. Both now share
  DESKTOP_VIEWPORT (1920×1080). A root `use.viewport` override in an app's
  playwright config never reached the chromium project anyway (project `use`
  wins), so solon's 1920 override was silently ineffective.
migration: |
  Drop app-level desktop viewport overrides. Specs asserting a layout that
  only exists below 1920px (collapsed sidebar, stacked panes) set their own
  viewport via test.use({ viewport }). Committed inline screenshots taken
  in the chromium project regenerate at 1920 width.
-->
