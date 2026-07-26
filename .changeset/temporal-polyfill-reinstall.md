---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Follow-up to #1587 / #1550 review findings: re-install Temporal via value export + Object.assign (ESM side-effect import was a no-op after teardown), drop dead Instant branch from stringifyJson (toJSON covers it; ambient-free test), narrow TzContext cast to polyfill typeof Temporal, drop dead isWithinGracePeriod re-exports from cancel handlers.
