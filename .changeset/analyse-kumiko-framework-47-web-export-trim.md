---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-framework": patch
---

`AppLayout` and `SenderFrame` are removed; `SenderSheet`, `DrawnFilter`, `DrawnPanel` and `DrawnWand` are no longer exported from `@cosmicdrift/kumiko-renderer/web`.

<!-- kumiko-changes
feature: renderer
type: breaking
title: Unused web exports removed
detail: `AppLayout` (with `AppLayoutProps`) and `SenderFrame` had no user in the framework, enterprise or any app and are deleted. `SenderSheet` and the icons `DrawnFilter`, `DrawnPanel` and `DrawnWand` stay as internals of the message thread, the data-table toolbar, the sidebar and the AI text field but leave the public `/web` entry. `PhotoSlots` and `PreviewWidthFrame` stay public.
migration: No known app imports these names. An app that does takes its layout from the `createKumikoApp` shell, wraps a letter in its own `Card`, and picks icons through the `icon` props of the primitives.
-->
