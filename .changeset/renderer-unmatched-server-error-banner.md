---
"@cosmicdrift/kumiko-renderer": patch
---

Keep the form error banner when a server validation issue has no rendered field to show it on.

<!-- kumiko-changes
feature: renderer
type: fix
title: Server validation issues without a rendered field keep the error banner
detail: |
  RenderEdit suppressed the banner as soon as the server returned any field issue, even one
  that no rendered field can display (`version`, `id`, a root-level refine, a condition-hidden
  field), so the save failed silently. The banner now stays whenever at least one issue has no
  visible field; tabs/wizard layouts still jump to the step holding the first matched field.
-->
