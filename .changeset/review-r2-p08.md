---
"@cosmicdrift/kumiko-bundled-features": patch
---

Review fixes: set-tenant-tier accepts only the sources manual and billing, the waitlist admin notice language comes from a new adminLocale option, and the tenant directory search contract is documented.

<!-- kumiko-changes
feature: tier-engine
type: fix
title: set-tenant-tier no longer accepts source default
detail: The source field of set-tenant-tier is limited to manual and billing. The value default is reserved for the signup default tier and made a manual grant look like a billing row that the next sync overwrites.
-->

<!-- kumiko-changes
feature: waitlist
type: fix
title: Admin notice language comes from adminLocale
detail: The admin notice mail used the request locale, which is the entrant's browser language. The new adminLocale option (en, de or es, default en) sets the operator's language.
-->

<!-- kumiko-changes
feature: tenant
type: fix
title: Tenant directory search contract documented
detail: A search returns the first limit matches in tenant-key order, sorted by label afterwards; the handler description now says so.
-->
