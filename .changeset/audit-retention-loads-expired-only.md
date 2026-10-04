---
"@cosmicdrift/kumiko-bundled-features": patch
---

Escape-hatch audit retention loads only rows that can expire

The retention job used to load every escapeHatchUse event to decide which ones to prune. It now reads the storing tenants with one grouped query and loads only events older than each storing tenant's cutoff. The same rows are pruned as before.

<!-- kumiko-changes
feature: audit
type: fix
title: Escape-hatch retention loads only expirable rows
-->
