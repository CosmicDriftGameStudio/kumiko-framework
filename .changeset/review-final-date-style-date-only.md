---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-document-designer": patch
---

The short/long date format control and the chip date hint appear only for date variables.

<!-- kumiko-changes
feature: template-resolver
type: fix
title: Date format control only for date variables
detail: The document editor offered the short/long date format for every placeholder and showed a date hint on its chip, although only variables of type `date` use it. `DocumentEditorProps` gains `dateVariables` (names of the date variables); the format buttons and the chip hint appear only for those. The PDF and mail designers and the document draft editor pass it from the variable schema.
-->
