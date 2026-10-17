---
"@cosmicdrift/kumiko-bundled-features": patch
---

PDF table documents reject oversized input

<!-- kumiko-changes
feature: renderer-pdf
type: fix
title: renderTablePdf rejects tables above 10000 rows, 30 columns or 5000 characters per cell
detail: The table document schema now caps rows at 10000, columns at 30 and each cell string at 5000 characters. Larger input fails with invalid_payload instead of exhausting memory during layout.
-->
