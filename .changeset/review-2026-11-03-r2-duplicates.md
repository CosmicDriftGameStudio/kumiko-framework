---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Deduplicate structurally identical helpers across bundled features and framework table bootstraps.

<!-- kumiko-changes
feature: framework
type: fix
title: Share duplicated helpers between bundled features
detail: Behaviour is unchanged. The user-data bridge features, hard-delete user-data hooks, bootstrap-extension lookups, preference (un)subscribe handlers, tenant cross-tenant db lookups, string-value picking in the template resolver and the idempotent meta-table bootstrap (pushTableIfMissing) each use one shared helper instead of copies.
-->
