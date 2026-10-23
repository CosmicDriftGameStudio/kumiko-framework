---
"@cosmicdrift/kumiko-renderer": patch
---

DataTable with resizable columns opens the row on a click in the leftover width, and its resize grips no longer collide with column names in getByLabel.

<!-- kumiko-changes
feature: renderer
type: fix
title: DataTable resizing: row click in the leftover width, grip named by title
detail: With column sizing the actions column absorbs the leftover width, and its cell swallowed every click, so a click on the free area to the right of the last column did not open the row. Only clicks from inside the cell (buttons, menus) stop now; a click on the empty cell reaches the row. The resize grips carry their text as title instead of aria-label, so getByLabel on a column name no longer matches the grip of every column. The accessible name stays, getByRole("separator", { name }) keeps working.
-->
