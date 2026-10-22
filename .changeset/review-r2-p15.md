---
"@cosmicdrift/kumiko-framework": patch
---

Review fixes: HTML fragments such as forms and iframes are no longer relabelled as XML, file uploads go through the tenant file context and its upload ledger, the upload ledger refuses a connection that is already inside a transaction, and a failed job runner start leaves no scheduler refresh timer behind.

<!-- kumiko-changes
feature: files
type: fix
title: More HTML roots are kept out of the XML content type
detail: Uploads without a declared content type whose root element is a common HTML element (form, iframe, input, table parts, media and others) are no longer labelled application/xml.
-->

<!-- kumiko-changes
feature: files
type: fix
title: POST /files uses the tenant file context and a transaction-safe upload ledger
detail: The upload route records and forgets upload bytes through the resolver's ledger like every other file context, and createFileUploadLedger throws when given a connection already inside a transaction.
-->

<!-- kumiko-changes
feature: jobs
type: fix
title: A failed runner start no longer leaves a scheduler refresh timer behind
detail: The scheduler-seen refresh timer starts only after the rest of start() succeeded, so a failed start does not keep stamping for a runner that is not running.
-->
