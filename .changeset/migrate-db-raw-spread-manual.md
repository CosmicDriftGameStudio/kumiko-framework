---
"@cosmicdrift/kumiko-framework": patch
---

The `migrate-db-raw` codemod no longer auto-rewrites own-tenant calls whose filter object has a spread after `tenantId`, since the spread can override it at runtime; such sites are listed for manual review.
