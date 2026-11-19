---
"@cosmicdrift/kumiko-bundled-features": minor
---

Agent write tools now ask the model for `version` and pass it through, so a write on a stale read fails with `version_conflict` instead of silently overwriting.

<!-- kumiko-changes
feature: agent-tools
type: breaking
title: Agent write tools keep optimistic locking
detail: For a write handler whose schema requires `version`, the tool catalog used to strip `version` from the tool's input schema, and dispatch read the current version from the detail handler right before the write. That turned off optimistic locking for agent writes: a model acting on an old read overwrote newer changes. `version` now stays a required tool argument and reaches the handler unchanged. A stale version returns `{ ok: false, code: "version_conflict" }` to the model, and the tool description tells it to read the record again. The `injectsVersion` field is gone from the write tool dispatch descriptor. The re-read through the detail handler after a successful write is unchanged.
migration: Agent-driven write calls must send `version` from the latest read. Code or tests that built write descriptors with `injectsVersion`, or relied on dispatch reading the version (for example a failing detail lookup before the write), drop that assumption and pass `version` in the tool input.
affects: injectsVersion, agent-tools
-->
