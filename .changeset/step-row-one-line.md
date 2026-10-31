---
"@cosmicdrift/kumiko-renderer": patch
---

StepList rows put sources and tags on one line and use the body text size.

<!-- kumiko-changes
feature: renderer
type: fix
title: Step sources and tags share one line
detail: A step's source links (now underlined) and its tags, including "Waiting for", wrap together in one 13px row instead of two stacked rows. The StepList section sets the 14px body size, so step titles no longer inherit a larger host size.
-->
