---
"@cosmicdrift/kumiko-framework": patch
---

List search through child rows only counts children whose detail handler admits the viewer.

<!-- kumiko-changes
feature: search
type: fix
title: Child-row search requires the child's detail access
detail: A parent list search matches through a searchable hasMany child only when the child entity's detail handler admits the viewer's roles. A child without a detail handler never contributes matches, so a viewer can no longer probe the content of an entity they cannot open.
-->
