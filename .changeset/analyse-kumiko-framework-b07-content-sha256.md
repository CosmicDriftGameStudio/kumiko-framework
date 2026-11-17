---
"@cosmicdrift/kumiko-framework": patch
---

File refs store the SHA-256 of their bytes.

<!-- kumiko-changes
feature: framework
type: improvement
title: fileRef carries contentSha256
detail: Every upload computes the hex SHA-256 of the stored bytes once and writes it to the new nullable fileRef field `contentSha256`; `CreatedFileRef` and the upload response carry it. Rows from before this version keep `null`. Apps need a schema migration for the new `file_refs.content_sha256` column (`kumiko-schema generate`).
-->
