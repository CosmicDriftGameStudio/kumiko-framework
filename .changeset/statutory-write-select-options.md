---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
---

Statutory system writes skip the select-option check; isUnchangedValue is shared with the form

<!-- kumiko-changes
feature: framework
type: fix
title: Retention and erasure writes skip the select-option rule
detail: Framework system-user updates that name a writePurpose (retention, erasure) are no longer blocked by conditional select options. The null-clear comparison helper isUnchangedValue moved to engine/screen-helpers and is exported from ui-types so the renderer form and the executor share one definition.
-->
