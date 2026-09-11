---
"@cosmicdrift/kumiko-bundled-features": minor
---

Add a `note-mention` row (tenant-scoped, Subject-annotated `subjectId`) filled from structured `@`-mentions when a note is written, and wire `notes-history-user-data`'s note-entry delete hook to shred the row-subject body of every note that structurally mentions the forgotten user — consulting the mentioned note's host entity retention strategy first, so `blockDelete`/`anonymize` still win over erasure. Free-text mentions without a structured `@`-reference are not detected; that gap is documented, not a regression.
