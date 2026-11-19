---
"@cosmicdrift/kumiko-framework": patch
---

Several validation hooks on the same target now all run; a later hook no longer replaces an earlier one.

<!-- kumiko-changes
feature: framework
type: fix
title: Validation hooks on one target are chained
detail: `r.hook({ type: "validation", target, handler })` stored one handler per target, so a second validation hook on the same target replaced the first and its check never ran. The hooks are now chained and their errors are concatenated; the target fails when any of them returns errors.
-->
