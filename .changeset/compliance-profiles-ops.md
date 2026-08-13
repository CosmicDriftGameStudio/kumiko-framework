---
"@cosmicdrift/kumiko-bundled-features": minor
---

New `compliance-profiles-ops` feature adds a `tenants-missing-profile` SystemAdmin query — the platform-wide counterpart to `compliance-profiles`' `needs-profile` (#2089). #2084 correctly stopped `needs-profile` from nagging a `TenantAdmin` who can no longer reach a picker narrowed to `access.systemAdmin`, but that left no one able to notice: `needs-profile` stays `TenantAdmin`-only by design, so a `SystemAdmin` who owns a platform-only picker had no way to see which tenants still silently run on `minimal-no-region`. `tenants-missing-profile` lists every enabled tenant with no row in `tenantComplianceProfile`, tenant-wide instead of scoped to the caller's own tenant.

Shipped as a separate feature (mirrors `folders-user-data`/`notes-history-user-data`) rather than folded into `compliance-profiles`, so apps that only mount the per-tenant picker are unaffected. `compliance-profiles-ops` is the one genuinely cross-tenant piece — it alone carries `r.systemScope()` and a hard `r.requires("tenant")`; mount it alongside `compliance-profiles` and `tenant` for operator visibility.
