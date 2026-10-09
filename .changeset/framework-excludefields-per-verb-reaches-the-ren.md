---
"@cosmicdrift/kumiko-framework": minor
---

excludeFields per verb reaches the renderer and the agent manifest

WriteHandlerDef carries excludedFields; entityEdit screens get writeExcludedFields per verb. The edit form shows them read-only and keeps them out of the payload, create hides them, and the agent manifest lists them per handler.

<!-- kumiko-changes
feature: framework
type: improvement
title: excludeFields per verb reaches the renderer and the agent manifest
-->
