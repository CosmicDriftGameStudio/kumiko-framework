---
"@cosmicdrift/kumiko-framework": minor
---

Remove `buildDeepLinkUrl`/`DeepLinkTarget` from `@cosmicdrift/kumiko-framework/engine` — the export shipped with zero consumers repo-wide (definition, test, and barrel export only), so it was dead, speculative surface (#914 review finding). Reintroduce alongside the actual notification-template consumer that needs it.
