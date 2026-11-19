---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": minor
---

Public routes take their tenant from the server's host resolution; managed-pages and seo no longer need an app resolver for it.

<!-- kumiko-changes
feature: host-routing
type: breaking
title: r.httpRoute gets deps.hostTenantId(); managed-pages and seo default to it; createHostTenantIdResolver is removed
detail: `r.httpRoute` handlers receive `hostTenantId()`, the tenant the server's anonymous host resolution maps the request to (`anonymousAccess.defaultTenantId`, else the registered tenant resolver such as host-routing, checked against `tenantExists`). It never reads X-Tenant or the tenant cookie. `resolveApexTenant` of `createManagedPagesFeature` and of the seo `managedPages` option is now optional and defaults to it; a passed resolver receives `(host, { hostTenantId })`. host-routing's `createHostTenantIdResolver(options, db)` is removed, so apps no longer bind a module-global resolver to a raw connection at boot.
migration: Remove `createHostTenantIdResolver` and the boot-time binding around it, and drop `resolveApexTenant` from `createManagedPagesFeature` / the seo `managedPages` option when host-routing already maps the host. Keep a `resolveApexTenant` only for a fixed tenant or a mapping that differs from the API's host resolution; it can call `deps.hostTenantId()`.
affects: createHostTenantIdResolver, resolveApexTenant
-->
