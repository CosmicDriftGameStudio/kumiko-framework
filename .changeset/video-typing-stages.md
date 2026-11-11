---
"@cosmicdrift/kumiko-testing": minor
---

The e2e video tooling gains two typed stages: `terminalStage` and `editorStage` build a self-contained HTML document with a macOS-style window, character-by-character typing and a blinking cursor, plus the total duration to pass to `tools.animate`. Both optionally show an app screenshot on the right (`preview`) with a focus switch, highlights (one or several boxes) and cards. The preview can show a `beforeImageUrl` while typing that crossfades to the result at the focus switch. All motion is pure CSS keyframes, so the frame-stepped video renderer captures it deterministically.

Long terminal commands in the preview variant wrap with stable lines and reveal character by character, and the `exit 0` meta no longer breaks mid-text. A video definition accepts an optional `playbackRate` (0.5 to 2) that speeds up picture, narration and subtitles together.

`tools.type` now types into the focused field with the keyboard, so segmented inputs like time keep their cursor between keys instead of jumping back to the first segment. Videos run with an app boot budget of 60, because a video walks through the app page by page on purpose.

<!-- kumiko-changes
feature: testing
type: feature
title: Terminal and code editor stages for e2e videos
detail: `terminalStage` and `editorStage` from `@cosmicdrift/kumiko-testing/e2e` return `{ html, durationMs }` for `tools.stage` and `tools.animate`. Typing rhythm is seeded, so the same options always produce the same video. The editor stage highlights TypeScript without extra dependencies.
-->
