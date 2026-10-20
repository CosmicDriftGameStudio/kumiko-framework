---
"@cosmicdrift/kumiko-testing": minor
---

Add `withEnv` and `readSseFrames` to the test helpers. `withEnv` sets environment overrides for one callback and restores the previous values afterwards, deleting keys that were unset before. `readSseFrames` reads an SSE response up to a condition, joining chunks and multi-line data fields, skipping pings and cancelling the stream.

<!-- kumiko-changes
feature: testing
type: improvement
title: withEnv and readSseFrames test helpers
detail: withEnv restores process.env after a callback so parallel no-isolate runs do not leak variables; readSseFrames replaces hand-written SSE stream parsers in tests.
-->
