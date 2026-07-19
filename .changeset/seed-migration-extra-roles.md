---
"@cosmicdrift/kumiko-framework": patch
---

`ctx.systemWriteAs` in seed-migrations accepts an optional `extraRoles` 4th
argument. `hasAccess` has no system-bypass — handlers gated on an explicit
role (e.g. `access: { roles: ["SystemAdmin"] }` or `["anonymous"]`) reject
the bare `system` actor with `access_denied`. Seeds that need to reach such a
handler can now pass the required role(s) alongside `createSystemUser`'s
existing `extraRoles` support, instead of being unable to call it at all.
