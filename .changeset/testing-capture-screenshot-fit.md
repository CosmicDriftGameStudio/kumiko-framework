---
"@cosmicdrift/kumiko-testing": patch
---

`captureScreenshot(page, name, { fit })` (fw#3118)

<!-- kumiko-changes
feature: testing
type: improvement
title: captureScreenshot accepts fit viewport, fullPage or content
detail: |
  `fit: "viewport"` (default) keeps the previous behaviour. `fit: "fullPage"`
  captures the whole document, so offlot's inline mid-flow shots
  (channel-request, channel-prompts, vehicle-channel-texts) can move to
  captureScreenshot. `fit: "content"` grows the viewport until neither the
  document nor a visible overflow-auto/scroll container (WorkspaceShell's
  inner scroll area) overflows, captures, and restores the viewport; it
  throws instead of writing a cropped image when growth does not converge
  within 4 rounds. A 1px container overflow counts as sub-pixel rounding
  (overflow-x-auto table wrappers), not content. This replaces solon's own `e2e/_helpers/shot.ts`; its
  images pick up the `reducedMotion: "reduce"` default on the switch, so a
  one-time pixel drift in the handbook PNGs is expected.
-->
