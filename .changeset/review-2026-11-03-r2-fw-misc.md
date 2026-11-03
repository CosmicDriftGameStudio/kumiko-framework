---
"@cosmicdrift/kumiko-framework": patch
---

Pin test coverage for unique-violation causes, pool-path projections, RLS boot hints, sort nulls, file-owner read gates and sub-processor metadata; note the meilisearch peer range.

<!-- kumiko-changes
feature: framework
type: fix
title: Tighter tests; search/meilisearch needs meilisearch ^0.62.0
detail: Tests only, no runtime change. The tests now assert the Postgres unique-violation and constraint name, run the custom projection on the pool path in the success case, check the schema command hints of the RLS boot check, cover sortNulls first and sortNulls on reference fields, cover the two fail-closed read-model conditions of readGate.fileOwner separately, and put purpose and addedAt into the sub-processor snapshot. As recorded for the Renovate bump, the optional peer dependency of search/meilisearch is meilisearch ^0.62.0 (was ^0.58.0); consumers on 0.58 fail the peer check.
-->
