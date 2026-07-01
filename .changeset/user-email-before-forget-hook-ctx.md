---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Add `userEmailBeforeDelete` to `UserDataHookCtx` so forget delete-hooks can match user-owned rows across every tenant pass before the user row is anonymized.
