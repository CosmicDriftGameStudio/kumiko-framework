---
"@cosmicdrift/kumiko-framework": patch
---

List search and sort by a reference field now ignore soft-deleted target rows: a deleted customer's name no longer matches a reference search and no longer decides the position in a label sort. The blind-index sweep checks table existence in the `public` schema instead of relying on the session `search_path`. The Scaleway key-manager retry cancels the response body of a retried 5xx instead of leaving it open.

<!-- kumiko-changes
feature: framework
type: fix
title: reference search and sort skip soft-deleted targets, blind-index sweep resolves tables in public, key-manager retry releases 5xx bodies
-->
