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
- `FileContext.ref` and `list` (tenant-bound) refuse keys outside `${tenantId}/`; list columns accept `virtual: true`; `httpRoute` session-only routes now pass the global IP rate limit; tenant timezone cache TTL is 30 s; text fields without a personal stance warn at boot; the orphan-derivative sweep keeps derivatives whose original still exists; `piiFields` owner fields that can never yield a string throw unless `whenAbsent` is set.

<!-- kumiko-changes
feature: files
type: breaking
title: FileHandle.derive throws for suffixes outside <name>-<16 hex>
migration: Build the suffix with variantSuffix(name, spec) instead of passing a free-form string.
-->

<!-- kumiko-changes
feature: files
type: breaking
title: A tenant-bound FileContext.list throws for prefixes outside the tenant's key space
migration: Pass a prefix that starts with `${tenantId}/`.
-->

<!-- kumiko-changes
feature: files
type: breaking
title: A tenant-bound FileContext.ref throws for keys outside the tenant's key space
migration: Use keys that start with `${tenantId}/`.
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: defineFeature throws when dedupeOptions holds a nested object
migration: Flatten dedupeOptions to primitive values.
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: Boot validation rejects an object-form redirect with idFrom on a screen that has no id
migration: Point the redirect at a screen with an id or drop idFrom.
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: A list column absent from the query output schema must set virtual: true
migration: Add virtual: true to computed columns that are not part of the query output.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Session-only httpRoutes now pass the global IP rate limit
-->

<!-- kumiko-changes
feature: files-tenant-data
type: fix
title: The orphan-derivative sweep keeps derivatives whose original still exists in storage
-->
