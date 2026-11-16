---
"@cosmicdrift/kumiko-bundled-features": patch
---

The storage stage of tenant destroy checks kept files with a set lookup instead of comparing every key against every kept file.

<!-- kumiko-changes
feature: files-tenant-data
type: improvement
title: Tenant destroy keeps handed-over files without a quadratic scan
detail: The storage stage of tenant destroy keeps the bytes of files a foreign tenant still references, together with their derivatives. It used to compare every listed key with every kept file; it now looks each key up in a set of kept stem prefixes, so a tenant that handed over many files before its destroy no longer costs keys times kept comparisons. Which keys are kept and which are deleted does not change.
-->
