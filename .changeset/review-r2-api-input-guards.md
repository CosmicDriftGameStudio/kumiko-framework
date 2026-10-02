---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-dev-server": patch
---

`POST /api/auth/switch-tenant` answers 400 `invalid_tenant` for a missing or non-string `tenantId` instead of feeding it into the membership lookup. A non-string `type` in a request body no longer turns a 4xx into a 500 inside the fault logger. The PII ciphertext response guard now matches the full ciphertext shape, so user text containing the bare `kumiko-pii:v` marker no longer 500s reads. `kumiko upgrade --apply` records `pendingManual` in the marker when no codemod runs.

<!-- kumiko-changes
feature: framework
type: fix
title: switch-tenant validates tenantId, fault logger tolerates non-string type, PII guard matches full ciphertext shape
-->
