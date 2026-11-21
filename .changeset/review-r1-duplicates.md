---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Merged duplicated helpers found by the semantic-duplicates guard.

<!-- kumiko-changes
feature: framework
type: fix
title: Deduplicated attribute readers, sealed-payload parsing, webHost, deletion token screens and purpose digests
detail: A single `readEnumAttribute`, `parseSealedPayload`, `webHost`, `DeletionTokenScreen` and `createPurposeDigest` replace parallel copies. The entity list search check now also counts searchable longText fields, matching the registry's searchable-field collection, so a list over an entity whose only searchable field is longText is no longer reported as unsearchable.
-->
