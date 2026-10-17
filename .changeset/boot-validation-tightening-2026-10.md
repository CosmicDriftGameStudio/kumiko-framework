---
"@cosmicdrift/kumiko-framework": patch
---

Several boot validations reject configurations that used to boot

<!-- kumiko-changes
feature: framework
type: breaking
title: Boot rejects visibleWhen queries with required input, non-sql index where clauses, lockedWhen on read-restricted fields and same-named features with a different surface
detail: |
  These checks used to be absent or silent and now stop the app at boot:
  - A screen or dashboard panel visibleWhen that names a query whose input schema does not accept an empty payload. The client gate runs it with an empty payload, so the screen stayed hidden.
  - An entity index where that is not a sql expression. It used to be dropped, which built a full (unique) index.
  - A lockedWhen field that declares access.read.
  - Two features with the same name whose screens, navs, jobs, events, translations, config keys, notifications, metrics or hooks differ. The second one used to be dropped.
migration: |
  Boot each app once against the new version. For a visibleWhen query, make its input fields optional or point visibleWhen at an input-free query. Write index where clauses with sql`...`. Remove access.read from the lockedWhen field or lock on a field every role can read. Give differing same-named features distinct names or make their surfaces identical.
-->
