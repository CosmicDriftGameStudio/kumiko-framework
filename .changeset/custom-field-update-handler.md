---
"@cosmicdrift/kumiko-bundled-features": minor
---

custom-fields: neuer `update-tenant-field`-Write-Handler (Bug-Bash D2)

Vollersatz-Edit für bestehende Field-Definitionen — Payload-Shape wie
define, Identität via (entityName, fieldKey), `type` ist immutable
(422 `field_type_immutable`; Type-Wechsel = delete + re-define).
Kein delete+redefine im Update: Event-Historie und Field-Ids bleiben
erhalten. QN: `custom-fields:write:update-tenant-field`.
