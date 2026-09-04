---
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-dev-server": patch
---

Fix `startDevJobRunners` (dev-server boot) never calling `attachDispatcher()` on its per-lane job runners, so `ctx.write`/`ctx.queryAs` inside any dev-run job threw "dispatcher attached — call attachDispatcher() first" on their first call. Production entrypoints were unaffected — they already wire this automatically.
