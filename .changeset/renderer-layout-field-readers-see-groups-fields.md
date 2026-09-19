---
"@cosmicdrift/kumiko-renderer": patch
---

Layout field readers see groups[].fields

layoutEditFields flattens section.groups, so required fields inside a groups-only section are presence-validated by buildFormSchema and survive the renderableFields gate for search-param prefills.

<!-- kumiko-changes
feature: renderer
type: fix
title: Layout field readers see groups[].fields
-->
