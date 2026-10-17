---
"@cosmicdrift/kumiko-framework": patch
---

The pdf-audit-export recipe uploads the PDF before the transaction

<!-- kumiko-changes
feature: framework
type: improvement
title: The pdf-audit-export recipe uploads the PDF before the transaction
detail: The shipped pdf-audit-export example now renders and uploads the PDF in a beforeTransaction phase with uploadFileBytesBeforeTransaction and creates the fileRef row in the handler with createFileRefFromUploadedBytes, so the upload holds no pool connection. No runtime change.
-->
