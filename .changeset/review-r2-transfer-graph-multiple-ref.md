---
"@cosmicdrift/kumiko-framework": patch
---

The transfer-graph boot check now rejects a `multiple` reference on a transferable entity only when the target entity is itself transferable. A multiple reference to a plain lookup entity boots again.

<!-- kumiko-changes
feature: framework
type: fix
title: Transfer-graph boot check rejects a multiple reference only when its target is transferable
-->
