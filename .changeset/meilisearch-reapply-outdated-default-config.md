---
"@cosmicdrift/kumiko-framework": patch
---

Meilisearch adapter re-applies the default index config when it gained fields

<!-- kumiko-changes
feature: framework
type: fix
title: Existing tenant indexes pick up searchable fields added to the registry default
detail: The lazy default configuration now also applies to an index whose stored searchable, filterable and sortable attributes are a strict subset of the current default (an older default after a deploy added fields). Indexes holding any attribute outside the current default are treated as an explicit configure() and stay untouched, as before.
-->
