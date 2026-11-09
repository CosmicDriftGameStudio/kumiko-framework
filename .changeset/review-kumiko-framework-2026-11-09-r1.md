---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-feature-ast": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-testing": patch
---

Review fixes: signature ink check and signer email, field AI assist, shell accessibility and PWA scope, video setup tools, monotonic ingest progress, feature-ast parse errors, kms codemod hints, plural and formal-address checks, and tests.

<!-- kumiko-changes
feature: document-ingest-foundation
type: fix
title: Ingest progress only moves forward
detail: Parallel `reportIngestProgress` calls for one file can land in any order; the progress row now keeps the highest `pagesDone`, a report whose progress is already stored stops early, and after 10 version conflicts the call throws instead of returning silently.
-->

<!-- kumiko-changes
feature: signature
type: fix
title: Empty signatures are rejected on every background
detail: The ink check treats an image as having a solid background only when all four corners are opaque and identical; a lone opaque pixel no longer counts the whole image as ink, and signer emails must be valid addresses.
-->
