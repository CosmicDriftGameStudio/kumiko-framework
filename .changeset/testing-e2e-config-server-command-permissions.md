---
"@cosmicdrift/kumiko-testing": minor
---

defineAppE2eConfig accepts permissions, launchOptions, a custom server command and Bun preloads

<!-- kumiko-changes
feature: testing
type: improvement
title: defineAppE2eConfig accepts permissions, launchOptions, a custom server command and Bun preloads
detail: |
  Apps that need browser permissions (camera, microphone), Chromium launch flags such as fake media devices, or a preloaded module for the e2e server no longer have to hand-roll their Playwright config. permissions and launchOptions land in the shared use block. preload (one path or a list) is prefixed to serverEntry as bun run --preload flags; serverCommand replaces the whole server start command and cannot be combined with serverEntry or preload.
-->
