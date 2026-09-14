---
"@cosmicdrift/kumiko-framework": minor
---

A `searchable: true` reference field can now match a text search term against a target row's `labelField` even when that field is encrypted or PII — the match runs through the target entity's own search-adapter index (the same derived-plaintext index `personal` + `find: "fuzzy"` fields already build for their own list's search, #1610) instead of the ILIKE lookup used for a plain-text labelField, which can never match ciphertext. Candidate ids from the index are re-checked against the target entity's own row-level read access for the acting user before they can surface a row — the index itself carries no ownership awareness.

**Breaking:** the boot validator now rejects a `searchable: true` reference field whose target `labelField` is encrypted or PII but not itself `searchable: true` (with `find: "fuzzy"` when it also carries a `personal` annotation) — there would be no plaintext anywhere, ILIKE or index, to ever match a search term against, so the field was a silent, permanent non-match at runtime before this change.
