---
"@cosmicdrift/kumiko-renderer": patch
---

Toolbar navigate actions are hidden when the user may not open the target screen

<!-- kumiko-changes
feature: renderer
type: fix
title: Toolbar navigate actions are hidden when the user may not open the target screen
detail: A toolbarAction of kind navigate on entityList, projectionList and relatedList now follows the access rule of its target screen, the same check metric jumps use. Before, the button showed for every role and led to an access-denied page.
migration: None. Gate the target screen with its own access rule; the toolbar button follows it.
-->
