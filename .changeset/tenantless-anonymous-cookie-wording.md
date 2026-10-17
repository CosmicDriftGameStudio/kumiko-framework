---
"@cosmicdrift/kumiko-framework": patch
---

Correct the tenantlessAnonymous release note about the tenant cookie

<!-- kumiko-changes
feature: framework
type: fix
title: tenantlessAnonymous is blocked by an X-Tenant header only, not by the kumiko_tenant cookie
detail: An earlier release note said a tenantlessAnonymous handler never runs when the client supplies X-Tenant or kumiko_tenant. Only the X-Tenant header blocks it. An ambient kumiko_tenant cookie does not, because the tenant resolver ignores the cookie on this path anyway.
-->
