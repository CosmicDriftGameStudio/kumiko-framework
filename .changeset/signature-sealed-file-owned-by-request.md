---
"@cosmicdrift/kumiko-bundled-features": minor
---

The sealed PDF of a completed signature request is now owned by its request, so documents filed from it pass the file-owner read gate of the documents feature.

<!-- kumiko-changes
feature: signature
type: breaking
title: Sealed signature PDF belongs to its request
detail: `signatureRequest.completedFileId` is now a file field instead of a text field, and the sweep stores the sealed `signed-document.pdf` attached to the request. Before, the file had no owner, so a document filed from it was hidden from every reader by the documents read gate.
migration: Run `schema:generate`; the column gains a foreign-key index. Existing values stay valid. Files sealed before this change stay unowned.
affects: signature, signatureRequest, completedFileId
-->
