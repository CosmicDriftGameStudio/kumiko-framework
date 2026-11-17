---
"@cosmicdrift/kumiko-bundled-features": minor
---

Document drafts are gated by their subject row through `parentRef`; `authorizeSubject` and `unscopedRoles` are removed.

<!-- kumiko-changes
feature: document-draft
type: breaking
title: Document drafts are visible through their subject row
detail: `subjectTypes` now names registered entities without their own `parentRef`, and the boot fails otherwise. Every handler and query answers 404 when the caller cannot read the draft's subject row through that entity's own `access.read`, `finalize` already before printing. `authorizeSubject`, `unscopedRoles` and `AuthorizeDocumentDraftSubject` are removed; `DocumentDraftSubject` is a plain `{ subjectType, subjectId }` type.
migration: Make `subjectTypes` the entity names of the subjects, drop `authorizeSubject` and `unscopedRoles`, and put the visibility rule into `access.read` of the subject entity. No schema change.
-->
