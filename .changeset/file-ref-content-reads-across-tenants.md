---
"@cosmicdrift/kumiko-bundled-features": patch
---

readFileRefContent reads handed-over files; fileContextForTenant takes the context tenant

<!-- kumiko-changes
feature: file-foundation
type: fix
title: readFileRefContent reads handed-over files; fileContextForTenant takes the context tenant
detail: readFileRefContent, readTemplateResource and the public variant query read bytes through FileContext.refFromFileRef, so a fileRef moved by a tenant handover is readable again. fileContextForTenant gains a `contextTenantId` argument: without a provider resolver it returns undefined for any other tenant instead of the context's files, which are bound to a different key space.
-->
