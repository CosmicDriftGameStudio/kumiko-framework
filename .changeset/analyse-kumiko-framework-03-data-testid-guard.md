---
"@cosmicdrift/kumiko-guards": patch
---

New guard freezes data-testid hooks in production code.

<!-- kumiko-changes
feature: guards
type: improvement
title: Data-Testid Guard ratchets test hooks in production code
detail: `data-testid` and `data-test` in non-test `.ts`/`.tsx` files (JSX attributes and `"data-testid"` object keys) are counted per file and frozen in `.kumiko-data-testid-baseline.json`; a file may not gain more. Tests select by role, label or text instead. Without a baseline file the guard only warns. Freeze the current state once with `kumiko-guards guards --write-baseline --guard="Data-Testid Guard"`.
-->
