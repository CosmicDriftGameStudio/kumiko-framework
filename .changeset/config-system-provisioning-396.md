---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

config: `access.withSystem(roles)` — system-provisionable tenant self-service keys (#396)

Tenant-scope self-service config (e.g. the managed-pages branding keys) had no
system-write path: a key whose write-role was `access.admin` rejected the system
executor (`ctx.systemWriteAs`, roles `[SYSTEM_ROLE]`), so provisioning/migration
jobs could not set it without making the key system-only (which kills
self-service). The publicstatus continuity migration had to fall back to raw SQL.

`access.withSystem(roles)` composes any role preset with `SYSTEM_ROLE`
(`access.withSystem(access.admin)` → `["system", "TenantAdmin", "Admin",
"SystemAdmin"]`). The key stays human-writable — `checkWriteAccess` only collapses
to system-only when system is the *sole* writer — so tenant admins keep editing it
via configEdit while provisioning can set it via `systemWriteAs`. The managed-pages
branding keys now use it; apps with custom roles get the same path. customCss stays
admin-only (not in the continuity-migration set — least privilege).
