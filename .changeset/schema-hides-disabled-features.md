---
"@cosmicdrift/kumiko-framework": minor
---

GET /api/schema hides screens and navs of features the tenant has switched off

<!-- kumiko-changes
feature: framework
type: feature
title: The app schema no longer lists screens, navs and workspaces of features a tenant has switched off
detail: A feature declared with r.toggleable() that is off for the caller's tenant (tier engine or feature toggles) used to stay in the nav while all its handlers answered 403 feature_disabled. GET /api/schema now drops its screens, navs, content collections and workspaces for that tenant, and every action, redirect, nav parent and workspace member that pointed at them is removed too. Entities and translations stay. The response is cached per role set and per set of disabled features, so tenants with the same set share one ETag. Without an effectiveFeatures resolver nothing changes.
-->
