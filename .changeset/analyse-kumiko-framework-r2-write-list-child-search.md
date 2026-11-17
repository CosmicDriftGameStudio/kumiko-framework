---
"@cosmicdrift/kumiko-framework": patch
---

A hasMany relation with searchable: true lets the parent's list search match through child rows.

<!-- kumiko-changes
feature: search
type: improvement
title: List search through child rows
detail: Declare searchable: true on a hasMany relation and a list search on the parent also returns parents whose child rows match the term. Child hits pass the child's tenant scope, row ownership and soft delete, and only count when the viewer may read every searchable field of the child. Paging and total stay exact; a capped candidate set sets searchTruncated.
-->
