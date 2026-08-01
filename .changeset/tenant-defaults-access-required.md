---
"@cosmicdrift/kumiko-bundled-features": minor
---

**BREAKING:** `defineCreateWithTenantDefaults`'s `access` option is now required instead of optional. A caller that omitted it registered a `:create` write handler with no access rule at all — silently unreachable to the audit that scans `writeHandlers` for missing access, and open to anyone who could reach the handler. Both existing call sites already pass `access`, so this is a type-level guard, not a behavior change for any current usage; a caller relying on the old optional shape needs to add an explicit `access` (e.g. `{ roles: ["Admin"] }`).
