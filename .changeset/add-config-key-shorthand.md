---
"@cosmicdrift/kumiko-framework": minor
---

Add `r.configKey(name, def)` — a single-key shorthand for
`r.config({keys:{name: def}})` that returns the bare `ConfigKeyHandle<T>`
directly instead of a wrapping record. Add the optional
`ConfigKeyDefinition.group` field, letting a feature bucket its masked
config keys under another feature's (or a shared, non-feature) Settings-Hub
namespace without that target feature knowing about it at compile time.
Both are purely additive — `r.config()` is unchanged, `group` defaults to
`undefined` everywhere.
