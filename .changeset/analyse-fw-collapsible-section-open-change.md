---
"@cosmicdrift/kumiko-renderer": patch
---

`CollapsibleSection` reports when the user opens or closes it through the new optional `onOpenChange` prop.

<!-- kumiko-changes
feature: renderer
type: improvement
title: CollapsibleSection gets onOpenChange
detail: The callback receives true or false whenever the user opens or closes the section, so a screen can defer expensive content until the section is open. defaultOpen does not trigger it, and children are still always rendered.
-->
