---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

GDPR forget (Art. 17): configurable tenant-occupancy model for tenant-scoped contributors.

A tenant-scoped contributor with no per-user column (e.g. credit) can now erase a forgotten user's data when the app runs one user per tenant. The `user-data-rights` feature exposes a system-scoped `tenantModel` config (`"single-user" | "multi-user"`, default `"multi-user"`); the forget pipeline refines it **per tenant** with a runtime sole-member check and hands the effective model to each delete-hook via `ctx.tenantModel`. A stray invite that makes the `"single-user"` claim false at runtime downgrades to `"multi-user"`, so a co-member's data is never deleted on a per-user forget. Default `"multi-user"` preserves the existing safe no-op behaviour. New public type `TenantUserModel`.
