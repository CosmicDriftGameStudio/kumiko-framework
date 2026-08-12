---
"@cosmicdrift/kumiko-bundled-features": patch
---

`form-draft`'s `ownerId` field is now `required: true` — it's always stamped server-side from `event.user.id` and never client-supplied, but the missing annotation let a draft with no owner exist, which `form-draft:query:list` (scoped by owner) would then silently never return.

Consuming apps: this is a `NOT NULL` change on an already-managed projection column, so the generated migration for it is a destructive `DROP TABLE` + `CREATE TABLE` (matching the framework's existing convention for in-place-unsafe schema changes) with a `.rebuild.json` marker — running it replays the `read_form_drafts` projection from the event log instead of migrating in place.
