---
"@cosmicdrift/kumiko-framework": minor
---

A failing PII key store raises its own error instead of a generic one.

<!-- kumiko-changes
feature: framework
type: improvement
title: KMS outages surface as EncryptionUnavailableError
detail: The PII key store configured with configurePiiSubjectKms wraps adapter failures (database, Key Manager, network) in EncryptionUnavailableError with code encryption_unavailable and HTTP status 503, exported from @cosmicdrift/kumiko-framework/crypto together with ENCRYPTION_UNAVAILABLE_CODE. Key-state errors (KeyNotFoundError, KeyErasedError, KeyAlreadyExistsError) keep their types. Callers can tell an outage, which they retry later, from a problem with the record.
-->
