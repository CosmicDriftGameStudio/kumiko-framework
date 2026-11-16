---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Job run logs are encrypted and decrypted with one key lookup per run instead of one per log line.

<!-- kumiko-changes
feature: framework
type: improvement
title: Batch PII encryption and decryption with one key lookup
detail: `encryptPiiValuesForSubject(kms, subject, values, kmsCtx, field)` from `@cosmicdrift/kumiko-framework/crypto` encrypts a list of strings for one subject with a single key lookup; values that are already ciphertext or the erased sentinel pass through, and an erased key throws `KeyErasedError` like `encryptPiiValueForSubject`. `decryptPiiValues(kms, values, kmsCtx, field)` decrypts a list of string ciphertexts with one key lookup per distinct subject; plaintext passes through and an erased subject yields the erased sentinel. The jobs feature uses them for run log lines, so writing a finished run and reading `jobs:query:details` no longer cost one `kumiko_subject_keys` query per log line.
-->
