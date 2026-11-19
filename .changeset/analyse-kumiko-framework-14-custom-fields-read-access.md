---
"@cosmicdrift/kumiko-bundled-features": minor
---

Custom fields now enforce `fieldAccess.read` on query results and index only fields marked searchable.

<!-- kumiko-changes
feature: custom-fields
type: breaking
title: Custom fields enforce read roles and the searchable flag
detail: The postQuery hook used to flatten every stored custom-field value for every caller, and the search extension indexed every value. Query results now carry only values whose definition exists and whose `fieldAccess.read` is empty, contains `"anonymous"` (public) or shares a role with the caller, in the flattened keys as well as in `customFields`. The search index gets only fields with `searchable: true` and no read restriction. Values without a live definition are no longer returned.
migration: Give roles that must see a restricted field a matching `fieldAccess.read` entry (`"anonymous"` for public reads). Mark fields that should be findable as `searchable: true` and run the reindex job for the host entity.
affects: custom-fields, createCustomFieldsFeature, customFields
-->
