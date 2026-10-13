---
"@cosmicdrift/kumiko-framework": minor
---

Boot rejects a subject annotation (`personal: "self"`, `"tenant"`, `{ of: "<field>" }`) on a single `createFileField` or `createImageField`. Their column is a uuid, which cannot store the ciphertext the annotation produces, so the first write with a KMS configured failed. Use `createFilesField` or `createImagesField`, which store the ids in jsonb and support `personal`, or `personal: false` with a reason. `personal: "ref"` is unchanged. The boot message for an index on a `files`/`images` field now names the real reason, a jsonb array cannot be indexed as a column.

<!-- kumiko-changes
feature: framework
type: breaking
title: Single file and image fields cannot carry a subject annotation
detail: validatePiiAndRetention throws for a file or image field with pii, userOwned, tenantOwned or recordOwned. The uuid column cannot hold the ciphertext, so such a field never worked with a KMS configured.
migration: Replace createFileField({ personal }) with createFilesField({ personal, maxCount: 1 }) or createImageField({ personal }) with createImagesField({ personal, maxCount: 1 }), or drop the annotation and set personal: false with a reason. The column becomes a jsonb array; run kumiko schema generate and rebuild the entity projection as described in the plural file fields entry.
-->
