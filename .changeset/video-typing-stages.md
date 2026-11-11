---
"@cosmicdrift/kumiko-testing": minor
---

The e2e video tooling gains two typed stages: `terminalStage` and `editorStage` build a self-contained HTML document with a macOS-style window, character-by-character typing and a blinking cursor, plus the total duration to pass to `tools.animate`. All motion is pure CSS keyframes, so the frame-stepped video renderer captures it deterministically.

<!-- kumiko-changes
feature: testing
type: feature
title: Terminal and code editor stages for e2e videos
detail: `terminalStage` and `editorStage` from `@cosmicdrift/kumiko-testing/e2e` return `{ html, durationMs }` for `tools.stage` and `tools.animate`. Typing rhythm is seeded, so the same options always produce the same video. The editor stage highlights TypeScript without extra dependencies.
-->
