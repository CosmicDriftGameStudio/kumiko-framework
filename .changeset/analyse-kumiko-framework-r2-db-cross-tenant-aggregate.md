---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
---

`ctx.crossTenantReads` and the job facet's cross-tenant reads gain `aggregate(table, spec, where?)`, audited and metered like the other cross-tenant reads.

<!-- kumiko-changes
feature: framework
type: improvement
title: Cross-tenant aggregate reads
detail: A handler or job granted `crossTenantReads` can now run `crossTenantReads.aggregate(table, { measure, groupBy? }, where?)` across every tenant, so usage and cost totals over all tenants are computed in SQL instead of pulling rows into memory under a row limit. Each call reports a `cross-tenant-read` escape-hatch use like selectMany, fetchOne and count.
-->
