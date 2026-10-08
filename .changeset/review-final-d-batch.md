---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-types": patch
---

Final review batch D.

- `FileHandle.derive(suffix)` now throws unless the suffix is `<name>-<16 hex>` (build it with `variantSuffix(name, spec)`). Free-form suffixes such as `derive("thumb")` wrote keys the forget/tenant-destroy sweep could not recognize, so those binaries survived erasure. Callers passing a bare name must switch to `variantSuffix`.
- `resolveKmsWiring` / `requireKmsWiring` throw when a `*_CIPHERTEXT` slot is set without its plaintext, pointing at the async entry points, instead of a misleading "trio required" error or a silent plaintext-PII fallback.
- Event-PII owner/`whenAbsent` resolution now also runs without a configured KMS, so a missing owner fails in dev like in prod.
- PII event backfill queues rebuilds under a per-run migration id, so a peer replica's re-queue is no longer cleared by another run.
- `seedAdminGuarded` re-writes the canonical admin's email so the blind index is repaired, and skips undecryptable foreign user rows instead of aborting the boot seed.
- A tenant-bound `FileContext.list` refuses prefixes outside the tenant's key space.
- An entityList whose create screen was dropped for the caller's roles now carries `createUnavailable`, so the renderer no longer falls back to a generic create form.
- Boot validation rejects an object-form `redirect` with `idFrom` whose same-feature target screen carries no id.
- `defineFeature` throws when `dedupeOptions` holds a nested object (it can never compare equal across two mounts).
