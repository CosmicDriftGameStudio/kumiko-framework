---
"@cosmicdrift/kumiko-framework": patch
---

`waitForEvent` match atoms no longer match events that lack the referenced payload path, so `ne` no longer wakes a workflow on an unrelated event shape. Explicit `undefined` optionals on `r.nav()` entries are dropped from the client schema.

<!-- kumiko-changes
feature: framework
type: fix
title: waitForEvent ne-match ignores payloads without the referenced path
-->

<!-- kumiko-changes
feature: framework
type: fix
title: r.nav() explicit undefined optionals no longer reach the client schema
-->
