---
"@cosmicdrift/kumiko-framework": patch
---

fw#2765: the search-index event consumer now indexes named domain events (e.g. `invoice.received`, `invoice.paid`) on entities with searchable fields, instead of silently skipping any event whose verb isn't `created`/`updated`/`restored`/`deleted`/`forgotten`. On an unknown verb it checks whether the aggregate's entity declares searchable fields; if so it reads the live projection row (tenant-scoped, via the same `entityTableFromRegistry` + `TenantDb` mechanism consumers already use) and indexes from that, or removes the index entry if no row exists (hard/soft-deleted). Non-searchable entities keep incurring no extra query. `created`/`updated`/`restored`/`deleted`/`forgotten` are unchanged.
