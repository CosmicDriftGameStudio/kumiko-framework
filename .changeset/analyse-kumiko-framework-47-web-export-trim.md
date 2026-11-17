---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-framework": patch
---

`SenderFrame` is removed; `SenderSheet`, `DrawnFilter`, `DrawnPanel` and `DrawnWand` are no longer exported from `@cosmicdrift/kumiko-renderer/web`.

<!-- kumiko-changes
feature: renderer
type: breaking
title: Unused web exports removed
detail: `SenderFrame` had no user in the framework, enterprise or any app and is deleted. `SenderSheet` and the icons `DrawnFilter`, `DrawnPanel` and `DrawnWand` stay as internals of the message thread, the data-table toolbar, the sidebar and the AI text field but leave the public `/web` entry. `PhotoSlots` and `PreviewWidthFrame` stay public.
migration: No known app imports these names. An app that does wraps a letter in its own `Card`, and picks icons through the `icon` props of the primitives.
affects: SenderFrame, SenderSheet, DrawnFilter, DrawnPanel, DrawnWand
-->
