---
"@cosmicdrift/kumiko-renderer": patch
---

Header actions and list toolbars render every button and the search at one height, and a projectionList description keeps its distance from the page header.

<!-- kumiko-changes
feature: renderer
type: fix
title: Uniform control height in page headers and list toolbars, spacing for projectionList descriptions
detail: Buttons in the page header (create, toolbarActions, detail actions, form actions and app-added buttons such as the AI button) and in list toolbars (search, filters, secondary actions) now share one height, independent of the size a screen or app requested. A toolbarAction promoted into the page header no longer renders smaller than the standard create button. A projectionList without a toolbar no longer glues its description to the page header. The header of a CollapsibleSection ("Erweitert") has the same height as the form controls next to it.
-->
