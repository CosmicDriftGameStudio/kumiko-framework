---
"@cosmicdrift/kumiko-bundled-features": minor
---

`cap-overview`'s `CapSpec.usage`/`usageBatch` can now return `null` to mean "not measured yet" instead of a fake 0. `caps:usage` and `tenant-caps:list` pass that through as `used: null`/`percent: null`, and the dashboard cards + usage bar render a "Not measured yet" message instead of a misleading 0%-full bar. Existing callers returning a plain `Promise<number>` are unaffected — this is additive.
