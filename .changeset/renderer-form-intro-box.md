---
"@cosmicdrift/kumiko-renderer": patch
---

When a form's title sits in the shell header, its subtitle (`screen.description` or `screen:<id>.subtitle`) renders as an info banner (`testId="render-edit-intro"`) at the top of the form instead of a bare muted line under the missing title. The "All fields are required." hint moves into that banner. Forms without a shell header, drawers and wizards with a step rail keep the old layout.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Form intro as an info banner
detail: With the title in the shell header, the form subtitle shows as a primary info banner at the top of the form, with the all-fields-required hint inside it. Other layouts are unchanged.
-->
