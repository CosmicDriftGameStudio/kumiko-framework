---
"@cosmicdrift/kumiko-renderer": minor
---

The props type of the `Drawer` widget from `@cosmicdrift/kumiko-renderer/web` is renamed to `DrawerPanelProps`.

<!-- kumiko-changes
feature: renderer
type: breaking
title: Drawer widget props type is DrawerPanelProps
detail: `@cosmicdrift/kumiko-renderer/web` exported a `DrawerProps` type that differed from the `DrawerProps` primitive contract of `@cosmicdrift/kumiko-renderer`. The widget type is now `DrawerPanelProps`; the contract keeps its name.
migration: Replace `import type { DrawerProps } from "@cosmicdrift/kumiko-renderer/web"` with `DrawerPanelProps`.
affects: DrawerProps
-->
