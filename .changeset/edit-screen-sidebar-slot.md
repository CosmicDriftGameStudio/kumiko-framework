---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-renderer": patch
---

`slots.sidebar` puts a component in a column next to the form of an edit screen.

<!-- kumiko-changes
feature: renderer
type: improvement
title: slots.sidebar renders a column right of the form
detail: On entityEdit, actionForm and configEdit screens, `slots.sidebar` shows a component in a sticky column from `xl`; the form column keeps its width, and the section navigation is dropped. Below `xl`, and outside the padded screen form, it renders under the sections. The component receives the live form values.
-->
