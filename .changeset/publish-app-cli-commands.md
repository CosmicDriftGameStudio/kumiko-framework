---
"@cosmicdrift/kumiko-cli": minor
---

Ship the app-facing `agent`, `project` and `consumer` commands in the published `kumiko` binary. They previously existed only in the framework repo's private root package, so app repos installing `@cosmicdrift/kumiko-cli` got the scaffolding-only CLI under the same binary name (#2707).

Also fixes `kumiko project list` and `kumiko project status` crashing on the projection timestamps — they are `Temporal.Instant`, which has no `toISOString()`.
