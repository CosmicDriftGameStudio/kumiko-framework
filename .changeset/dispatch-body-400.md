---
"@cosmicdrift/kumiko-framework": patch
---

Dispatch routes answer 400 for unusable request bodies

`/api/write`, `/api/query`, `/api/command`, `/api/batch` and `/api/stream` return a validation error (400) for malformed JSON, a non-object body or a missing handler `type`. Before, those requests ended in an unclassified 500. `/api/auth/switch-tenant` treats a non-object body like a missing `tenantId`.

<!-- kumiko-changes
feature: framework
type: fix
title: Dispatch routes reject malformed or type-less request bodies with 400 instead of 500
-->
