---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

Config key validators get a db scoped to the tenant being written

<!-- kumiko-changes
feature: config
type: fix
title: Config key validate() receives a db scoped to the written tenant
detail: A SystemAdmin writing a config value for another tenant previously handed the validator a system-mode db that could read every tenant. `ConfigValidateContext.db` is now a `TenantDb` locked to the tenant the value is written for. The validator runs inside the write transaction, so a slow query there should set its own timeout.
-->
