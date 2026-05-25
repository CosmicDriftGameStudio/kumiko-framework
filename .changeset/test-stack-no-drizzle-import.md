---
"@cosmicdrift/kumiko-framework": patch
---

Remove leftover `drizzle-orm` dynamic import from `setupTestStack` projection
table setup. Use native `extractTableInfo` instead so downstream apps typecheck
without adding `drizzle-orm` as a devDependency.
