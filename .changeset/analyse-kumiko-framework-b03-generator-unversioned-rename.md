---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
---

`kumiko-schema generate` refuses a migration that drops and adds columns on an entity table without a raised `eventVersion`.

<!-- kumiko-changes
feature: framework
type: fix
title: Schema generate refuses entity column renames without an event migration
detail: A projection rebuild skips event payload keys that are no longer entity fields, so renaming a field dropped the old column, added the new one and silently lost every historical value on the next replay. `kumiko-schema generate` now exits 1 without writing a file when one diff drops and adds columns on an entity table while the entity's `eventVersion` is not higher than in the last snapshot. Raise `eventVersion` and add an `eventMigrations` step that maps the old field to the new one, or generate an unrelated drop and add as two migrations. Pure drops and pure adds are unaffected. Entity tables in `snapshot.json` now carry `entityEventVersion`; the next generated migration writes it without any SQL change.
-->
