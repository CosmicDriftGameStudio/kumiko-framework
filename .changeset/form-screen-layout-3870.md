---
"@cosmicdrift/kumiko-renderer": minor
---

FormScreenLayout puts custom screens on the standard form screen layout, and a Card without footer content no longer draws an empty footer bar

<!-- kumiko-changes
feature: renderer
type: improvement
title: FormScreenLayout gives custom screens the standard form screen layout
detail: New universal component FormScreenLayout (children, description, actions, secondaryActions, onSubmit, width, testId) renders the same left-aligned form column, section stack and pinned footer as an entityEdit screen. Fill it with Section primitives (title, icon, subtitle); description becomes the form subtitle.
migration: Custom form screens can replace FormScreenShell + Card with FormScreenLayout + Section.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: Card renders no footer bar for an empty footer slot
detail: slots.footer set to false or null (for example `hasDone && <Button/>`) left an empty grey footer bar. The bar now renders only when the footer slot has content.
-->
