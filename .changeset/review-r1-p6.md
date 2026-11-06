---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-document-designer": patch
---

A titled dashboard stat strip no longer leaves an empty cell for a tile the user may not open; dashboard cards share the hint sentence style, and a few docs and types are corrected.

<!-- kumiko-changes
feature: renderer
type: fix
title: Titled stat strip drops tiles the user may not open
detail: The strip wrapped every stat in its own cell, so a gated tile left an empty cell with a dangling separator. Gated tiles are now filtered before the cell is drawn. The dashboard card headline reuses the table's hint sentence class, the createPlacement and rowActionMode docs match the code, and TEMPLATE_EDITOR_SCREENS is read-only.
-->
