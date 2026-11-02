---
"@cosmicdrift/kumiko-framework": patch
---

Reference-data entities read system-tenant rows under RLS, the search consumer keeps removals held behind failed operations, PII payload scrubbing covers date and reference fields, exports no longer repeat rows across pages, and webhook payload checks see through nested and lazy schemas.

<!-- kumiko-changes
feature: framework
type: fix
title: reference-data RLS, search hold, scrub coverage, export paging, webhook strictness
detail: Entities of a feature with `referenceData` now carry `systemRowsReadable` on the push path as well as the migration path, so `kumiko_system_tenant_read` applies to them (migration 0065 in `use-all-bundled` is regenerated). A search consumer batch that fails an update keeps the later delete of the same event batch held instead of dropping it. `scrubEventPayloadFields` rejects personal lifecycle fields it cannot scrub and replaces date, timestamp and reference values with a type-matching sentinel. Export paging skips rows that a shifting offset returns twice. The webhook payload strictness check descends into record, map, set, tuple, intersection and lazy schemas without looping on recursive ones.
-->
