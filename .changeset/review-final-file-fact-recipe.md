---
"@cosmicdrift/kumiko-samples": patch
---

The documents recipe shows an actionForm success fact of type file, with an integration test that resolves the returned FileRef id per tenant.

<!-- kumiko-changes
feature: samples
type: fix
title: documents recipe shows the file success fact
detail: The `contract-copy` actionForm returns the contract's FileRef id as a success fact of `type: "file"`; the recipe test checks the id resolves through `/api/files/meta` for its tenant and not for another one.
-->
