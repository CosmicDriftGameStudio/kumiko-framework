---
"@cosmicdrift/kumiko-framework": minor
---

Complete soft-delete: auto cleanup cron, configurable grace period, and trash queries.

When any entity opts into `softDelete`, the framework now auto-wires:
- a `soft-delete:job:cleanup` cron (perTenant, nightly at 03:00) that hard-deletes rows soft-deleted longer than the grace period — bounding unbounded growth of soft-deleted rows;
- a `soft-delete:config:grace-days` tenant config key (number, default 30) controlling that window.

Query handlers can now request soft-deleted rows via `ctx.includeDeleted` (the entity-list query accepts an `includeDeleted` flag). Tenant and ownership filters still apply, so a trash query never widens what a user may see beyond the live list. The event stream is untouched — cleanup only purges the read-model rows.
