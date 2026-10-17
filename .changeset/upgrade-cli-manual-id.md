---
"@cosmicdrift/kumiko-framework": minor
---

kumiko-upgrade prints and returns a stable id for each pending manual step

<!-- kumiko-changes
feature: framework
type: improvement
title: kumiko-upgrade names each pending manual step by an id
detail: Every pending manual step of kumiko-upgrade now has a stable id, derived from the release version and the step title. The text output shows it in brackets and the JSON output carries it as manualId, so a script or an agent can tell steps apart and record which ones it has done.
-->
