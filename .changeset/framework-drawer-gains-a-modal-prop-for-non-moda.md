---
"@cosmicdrift/kumiko-framework": minor
---

Drawer gains a modal prop for non-modal side panels

Drawer accepts modal (default true, behavior unchanged). With modal={false} the overlay and the focus trap are gone, so the page behind stays interactive and its text can be selected and copied; Escape still closes, a click beside the panel does not.

<!-- kumiko-changes
feature: framework
type: improvement
title: Drawer gains a modal prop for non-modal side panels
-->
