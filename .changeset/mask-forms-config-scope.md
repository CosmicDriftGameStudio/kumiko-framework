---
"@cosmicdrift/kumiko-renderer": patch
---

Row actions stay on one line, edit forms keep declared columns and select width, and a system-scope configEdit reads the system level.

<!-- kumiko-changes
feature: renderer
type: fix
title: Single-line row actions, stable form columns and select width, system-scope configEdit
detail: Row actions never wrap onto a second line. In screen forms a section with explicitly declared columns (two or more) lays out as that many columns, and a select cell is as wide as a text cell instead of growing with its help text. A configEdit screen with scope system now reads the system level, so a SystemAdmin no longer sees the value of their own tenant row.
-->
