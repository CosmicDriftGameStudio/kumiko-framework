---
"@cosmicdrift/kumiko-framework": patch
---

File storage and locale hardening. `validateFileContent` now rejects binary bytes for an extension with a declared-MIME alias (a real `.xls` renamed to `.csv`), so custom upload routes using `validateFile` + `validateFileContent` are covered. `tenantExportPrefix` and `tenantStoragePrefixes` throw for a tenant id equal to the reserved `exports` segment. The local provider's `list()` only walks the prefix directory instead of the whole storage root. A file-provider plugin whose built provider lacks a required method now fails loudly at resolve time. `canonicalizeLocaleTag` normalizes region and script subtags (`de-AT`, `zh-Hant-TW`), so `X-Locale: DE-at` finds a `de-AT` mail registration.

<!-- kumiko-changes
feature: framework
type: fix
title: File content check covers csv alias, local list scoped to prefix, provider contract checked, locale tags canonicalized
-->
