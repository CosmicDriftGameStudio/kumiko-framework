---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-guards": patch
---

Low-severity database and crypto review fixes from the second review round.

<!-- kumiko-changes
feature: framework
type: fix
title: db, crypto and ingest-progress review fixes
detail: A failing `pg_advisory_lock` call now still resets `statement_timeout` before the reserved connection returns to the pool. The migration replay recognizes `CREATE TABLE "x"AS SELECT ...` without whitespace after a closing quote. A wrong-sized DEK from the key store raises `EncryptionUnavailableError` instead of `PiiCiphertextCorruptError`, so scrub and export no longer treat intact values as corrupt. Update and delete check row readability before loading and decrypting the row. Aggregate-type removal looks up its auxiliary tables unqualified (search_path) instead of in `public`. The shared `SYSTEM_ROW_LEVEL_SECURITY_SCOPE` constant is gone; dispatch and the migrate runner name their own reason, and the `[fixed-system-scope]` guard rule is removed. `reportIngestProgress` appends and projects in one transaction and retries on a stream version conflict. Forget now has tests for the `access.read` check and the system-user exemption.
-->
