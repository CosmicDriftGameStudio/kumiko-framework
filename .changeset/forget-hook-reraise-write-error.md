---
"@cosmicdrift/kumiko-bundled-features": patch
---

subjectForgetAfterDeleteHook and the helpdesk legacy-contact-config job rethrow a failed inner write as a KumikoError instead of the raw WriteErrorInfo. The caller now gets the inner error's code and status (for example 503 when the PII key store is down, 400 for a refused forget) and the log shows its message and cause instead of "internal_error: [object Object]".

<!-- kumiko-changes
feature: crypto-shredding
type: fix
title: A failed forget in the after-delete hook keeps its error code and message
detail: The hook threw forgotten.error, a plain WriteErrorInfo object, so the HTTP layer reported internal_error with the message "[object Object]" and no cause, even for a real KMS outage. It now throws reraiseAsKumikoError(forgotten.error). The helpdesk legacy-contact-config job had the same pattern and is fixed the same way.
-->
