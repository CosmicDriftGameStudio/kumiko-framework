---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

Boolean fields in flow forms use the new FieldCellWidth "toggle", which replaces "auto"

In flow forms (screen forms and drawers) a boolean field's label now shares the top line with its neighbours' labels and the switch sits on the input line. The `FieldCellWidth` union loses `"auto"` and gains `"toggle"`; the default web Grid maps it to a fixed minimum width.

<!-- kumiko-changes
feature: renderer
type: breaking
title: Boolean fields in flow forms use FieldCellWidth "toggle" instead of "auto"
migration: |
  Custom Grid/GridCell primitives keyed by FieldCellWidth: rename `auto` to `toggle`.
-->
