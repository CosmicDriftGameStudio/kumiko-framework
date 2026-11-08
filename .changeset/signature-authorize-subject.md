---
"@cosmicdrift/kumiko-bundled-features": minor
---

The signature feature takes `authorizeSubject` and `unscopedRoles` to limit requests to the subjects a user may see, and a request now needs a file the caller may open.

<!-- kumiko-changes
feature: signature
type: breaking
title: Subject check for the signature feature and a readable-file check on requests
detail: `createSignatureFeature({ ..., authorizeSubject, unscopedRoles })`: `authorizeSubject(ctx, user, { subjectType, subjectId })` runs for `request`, `cancel`, `issue-link`, `revoke-link`, `sign-in-person` and the queries, except for users holding a role of `unscopedRoles`; `false` answers like a missing record (not found, `null` or an empty page). `signatureRequest:list` keeps only the rows of allowed subjects for a scoped user and reads up to ten base pages to fill one answer (no 403; an answer can still hold fewer rows than `limit`, and it has no `total`); screens and nav stay at `access`. A scoped user must pass a `requestId` eq filter to `signatureSigner:list`, otherwise the query answers 403. `request` now also checks that the caller may read the document through the same decision as GET /files/:id; a file that is unknown or not readable answers `document_not_a_pdf`. `SIGNATURE_INVALID_LINK_REASON` is exported from `signature/static-sign`.
migration: Apps that request a signature on a file the caller cannot open through GET /files/:id bind it to a record the caller can read first. Apps with authorizeSubject pass a requestId eq filter to signatureSigner:list and do not rely on `total` of signatureRequest:list for scoped users.
-->
