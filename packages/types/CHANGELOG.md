# @cosmicdrift/kumiko-types

## 0.174.0

## 0.173.1

## 0.173.0

## 0.172.0

## 0.171.2

### Patch Changes

- c717af3: `NotifyOptions` gains an optional `recipientId` for the `route` (direct, no-user-account) delivery path. Previously `route:{email}` sends always logged `recipientId: null` in the delivery-attempt event, so `recipientAddress` (piiFields subject = recipientId) had no subject key to encrypt under and stayed plaintext. Callers without a user account (e.g. a share-token recipient) can now pass `recipientId` to tie the logged address to a crypto-shredding subject.

## 0.171.1

## 0.171.0

### Minor Changes

- 32123ff: `entityEdit`/`configEdit`/`actionForm`/`projectionDetail` screens can now set `layout.width` ("sm" | "3xl" | "4xl" | "full") to opt out of the hardcoded 3xl-centered form shell — useful for dense multi-column masks that previously left dead space on both sides (#1676). Unset stays "3xl" (unchanged default).

## 0.170.0

## 0.169.0

### Patch Changes

- 644274a: Fix `preSave` hooks being a silent no-op (#1672). `r.hook("preSave", ...)` was registered and boot-validated, but no dispatch path ever ran it — only `postSave`/`preDelete`/`postSaveBatch` were wired.

  `preSave` now runs for entity CRUD `create`/`update` handlers (`r.crud(...)`, `defineEntityCreateHandler`/`defineEntityUpdateHandler`), transforming `changes` before persistence and before ownership checks (authorization evaluates the final, hook-shaped row). Register per verb — there is no `{ allOf }` shorthand for `preSave` since create/update are separate handlers:

  ```ts
  r.hook("preSave", "contact:create", deriveDisplayName);
  r.hook("preSave", "contact:update", deriveDisplayName);
  ```

  Scope: only entity CRUD handlers that go through the event-store executor get this automatically. A fully custom `r.writeHandler` that doesn't call the executor must invoke `ctx.runPreSave(...)` itself.

## 0.168.0

### Minor Changes

- 4c7d3c9: `r.crud`/`registerEntityCrud` gain `verbAccess?: Partial<Record<EntityCrudVerb, AccessRule>>` to gate individual verbs (e.g. `delete`/`restore`) more strictly than the shared `write`/`read` access rule. Resolution per verb: `verbAccess?.[verb] ?? (isWrite ? write?.access : read?.access)`. Existing calls without `verbAccess` are unchanged.

## 0.167.1

### Patch Changes

- cf5302a: `ctx.tz.tenant`/`ctx.tz.user` no longer hardcode `"UTC"` — `tenant` now reads the `tenant:config:timezone` config key (via the already-wired `ctx.config` accessor, falling back to `"UTC"` when unset or no config feature is mounted) and `user` reads the new `SessionUser.timezone` field (set at login, falling back to `tenant`). `SessionUser` gains an optional `timezone` field, carried through the signed JWT (`JwtPayload.timezone`) the same way `roles` is (kumiko-framework#1636).

  `buildHandlerContext` (exported from `@cosmicdrift/kumiko-framework/pipeline`) is now `async` — it was previously synchronous. Direct external callers (not the normal dispatch path, which already awaits it) need to add `await`.

## 0.167.0

### Minor Changes

- 57c1da2: `packaging`: the six identity-sensitive error classes moved out of `@cosmicdrift/kumiko-types` into `@cosmicdrift/kumiko-framework` — `VersionConflictError`, `IdempotentAppendConflictError` and `ArchivedStreamError` to `/event-store`, `KeyErasedError`, `KeyNotFoundError` and `KeyAlreadyExistsError` to `/crypto`. Those are the public paths callers already import from, so nothing moves for consumers; the `@cosmicdrift/kumiko-types/event-store-errors` subpath is gone.

  With no classes and no local `Symbol()` left in it, `kumiko-types` no longer needs the single-copy guarantee a peerDependency buys, and framework/bundled-features declare it as a plain dependency. That closes the changesets cycle where a peer-dependent bump escalated every minor release to `1.0.0`.

### Patch Changes

- ce30a2c: `deps`: hono range raised to `^4.12.27` — the floor that carries the fixes for three advisories on the production HTTP layer: cross-request data disclosure in `hono/jsx` (context not isolated per request), server-side XSS via a JSX escaping bypass in `cx()`, and a dropped repeated request header in the API-Gateway v1 adapter. The old `^4.12.18` allowed the patched versions but the lockfile sat on 4.12.25, so the range now states the security floor instead of relying on resolution luck.
- 8647246: `secrets`: `SecretBrand` uses `Symbol.for("kumiko.secret")` instead of a per-copy `Symbol()`. Two resolved copies of the package branded with two different symbols, so `createSecret()` from one and `isSecret()` from the other disagreed — and `isSecret()` is the only check `assertNoSecretLeak` has, so the response-leak guard walked past the value and serialized the plaintext. Matches the `Symbol.for` treatment the schema symbols already use (#1632).

## 0.166.0

## 0.165.4

## 0.165.3

### Patch Changes

- e4a0b9b: Allow `searchable` on subject-annotated PII: decrypt into the derived Meili index and purge docs on Art.17 erase (fw#1610).

## 0.165.2

### Patch Changes

- ed36555: Rename `buildEntityTableMeta` → `deriveEntityTableMeta` so the helper is not mistaken for the unmanaged escape hatch (`defineUnmanagedTable`). Deprecated alias kept. Unmanaged builders now reject the reserved `read_` table-name prefix (#1208/#1220).

## 0.165.1

## 2.0.0

### Major Changes

- eb856c6: Fixes a batch of code-review findings across kumiko-framework/bundled-features/types (PR#1222/1501/1431/1529/1333/1461/1424/1439/1423/1337/1398/1252/1257/1489/1472/1452/1545/1543/1547/1549/1551).

  **Breaking:**

  - `makeAuthGate(LoginComponent, loginProps, MfaVerifyComponent, MfaSetupComponent)` and `makeSessionAuthGate(...)` (`@cosmicdrift/kumiko-bundled-features/auth-email-password`) now take a single `LoginRouteOptions` object instead of four positional args — the positional signature didn't scale past two optional MFA params. Update call sites to `makeAuthGate({ loginScreen, loginScreenProps, mfaVerifyScreen, mfaSetupScreen })`.

  **Fixes (non-breaking):**

  - `document-ingest-foundation`'s `documentExtractEntity.pages` column is now `encrypted: true` (stored as serialized JSON in an encrypted `longText` column instead of plaintext `jsonb` — the underlying Postgres column type changes from `jsonb` to `text`) — it held the full extracted text of ingested documents (invoices, IDs, contracts) in plaintext. Apps mounting this feature now need an entity-field-encryption master key configured (same requirement every other PII-encrypted field already has) if they don't already have one. No migration needed: this entity has no writer yet (`#1497` unlanded), so no app has persisted rows against the old `jsonb` shape.
  - `reindexEntity()`'s `ReindexEntityResult` gains `wouldIndexRows` — a dry run no longer inflates `indexedRows` (which now stays 0 when nothing was written); also now reports a `failures` entry instead of silently indexing a partial document when a searchable field can't be mapped from the read-table row.
  - `UserDataDeleteHook`'s return type now includes bare `void` in the union (previously only `undefined`), so a hook explicitly typed `Promise<void>` (not just a contextually-typed arrow literal) type-checks again.
  - `run-forget-cleanup` write-handler's response now includes `incompleteCount`/`incomplete` so operator tooling can see partial-deletion hook results, not just hard failures.
  - tenant `invitations`/`members` query handlers: bounded-concurrency (pool-limit 4) PII decrypt instead of a strict sequential loop, and `invitations` no longer decrypts `invitedBy` (a plain userId, never PII-encrypted at write time).
  - `packages/framework/src/db/dialect.ts`'s `KUMIKO_NAME_SYMBOL`/`KUMIKO_COLUMNS_SYMBOL`/`KUMIKO_META_SYMBOL` are now imported from `@cosmicdrift/kumiko-types/schema-table-types` everywhere internally instead of being re-declared per call site — `SchemaTable` now also carries `[KUMIKO_META_SYMBOL]`.
  - `peerDependencies["@cosmicdrift/kumiko-types"]` changed from `workspace:*` to `workspace:^` in `kumiko-framework`/`kumiko-bundled-features` (a staggered-bump consumer previously got two unresolvable exact peer pins); removed the no-op `peerDependenciesMeta.optional: false`.
  - `request-helper`'s `authHeader()` now caches one session id per `(user.id, tenantId)` instead of per `user.id` alone — the same user id holding sessions in two tenants previously got handed the wrong tenant's cached sid.
  - `auth-foundation`'s anonymous-access tenant-resolver/tenant-exists merge no longer casts through `as TenantResolver`/`as TenantExists` — the underlying function types were already structurally compatible.
  - `isSafeHref` (`@cosmicdrift/kumiko-headless`) now decodes HTML character references (`&colon;`, `&#58;`, `&Tab;`, `&#9;`, ...) before its scheme check — `javascript&colon;alert(1)`/`java&Tab;script:alert(1)` previously slipped through because neither contains a literal `:` for the pre-decode regex, but the browser decodes the entity back into an executable `javascript:` URL on click. Affects `renderSafeMarkdown` (page-render) and the renderer-web `Link` primitive.
  - `user-data-rights`'s `restrict-account` write-handler now runs the same cross-tenant membership check as `lift-restriction` — previously any Admin/TenantAdmin (not just SystemAdmin) could restrict a user's account and force-revoke their sessions regardless of tenant, as long as they held an admin role in _some_ tenant.
  - `dispatch-shared.ts`'s `runStreamInstrumented`: a close-time error from `generator.return()` (e.g. a handler's `finally` failing to release a cursor/unsubscribe) is now folded into the dispatcher error metric and span status when nothing else already failed, instead of being silently discarded; also drops the unused/untested `it.throw()` forwarding branch (no production caller ever calls `.throw()` on a dispatcher stream).
  - `event-store.ts`'s `ensureIdempotencyKeyIndex` re-verifies the index is actually valid before treating a caught error as a benign concurrent-build race — a `lock_timeout` during `CREATE INDEX CONCURRENTLY` (55P03) was being misclassified as "the other pod already built it", silently leaving the idempotency-key uniqueness unenforced.
  - `routes.ts`'s SSE `pumpStream`'s finally block and the pre-pull client-abort path no longer `await generator.return(undefined)` — V8 queues that call behind an in-flight `.next()`, so awaiting it could hang the response indefinitely if the handler's pull never settles (e.g. a dead Redis/DB subscription after a client disconnect). Now fire-and-forget, matching the existing `stream.onAbort()` handler's style (which was already fire-and-forget).
  - `reindexEntity()` now fails fast with one clear error when a searchable field has no matching read-table column (dropped/never-migrated schema), instead of pushing one identical `failures[]` entry per scanned row.
  - `user-data-rights`'s GET `/user-export/by-token?token=` fallback now forwards `x-forwarded-for` to the internal `/api/query` call the same way the POST fragment-exchange route already does — previously every legacy magic-link download collapsed onto request-id-middleware's own (empty/localhost) IP, turning `download-by-token`'s per-IP 30/min rate limit into a single global bucket shared by every user (self-inflicted 429s). Also logs a warning on each hit so ops can see when it's safe to remove (kumiko-framework#1562).

  **Missed changesets (retroactively documented, already merged in #1547):**

  - `pumpStream`'s exported signature changed: `firstOutcome?: IteratorResult<unknown>` → `firstPull?: Promise<IteratorResult<unknown>>`.
  - `validateSessionStoreMultiplicity` no longer throws on zero registered `sessionStore` providers — a pure machine-API deployment (PAT-bearer auth only, no browser sessions) can now mount `auth-foundation` without also mounting `sessions`.
  - New public exports: `StreamFrame` (`kumiko-framework`/`-headless`), `isToggleableFeature` (`kumiko-framework`), `parseSseFrames`/`parseSseBlock`/`iterateSseChunks` (`kumiko-dispatcher-live`).

### Patch Changes

- c58f20f: `NumberFieldDef` / `createNumberField` accept optional `max` (mirrored from `min`); schema-builder applies Zod `.max()` at the write boundary so integer CRUD can reject values that would overflow Postgres `integer` (#1573).

## 1.0.0

### Patch Changes

- 53f83f5: `@cosmicdrift/kumiko-types` moves from a plain `dependency` to a `peerDependency` of both `@cosmicdrift/kumiko-framework` and `@cosmicdrift/kumiko-bundled-features` (kumiko-framework#1438).

  **Why:** `@cosmicdrift/kumiko-types` ships identity-sensitive runtime error classes (`VersionConflictError`, `ArchivedStreamError`, `KeyErasedError`, `KeyNotFoundError`, `KeyAlreadyExistsError`) despite its description previously claiming "no runtime code". If a consumer app installs `@cosmicdrift/kumiko-types` directly at a different version than the one framework/bundled-features resolve internally, `instanceof` checks against these classes silently return `false` across the two copies — a `catch (e) { e instanceof VersionConflictError }` in your app code would miss errors thrown from framework's own copy. Declaring it as a peer dependency forces a single resolved copy across the dependency tree instead of silently tolerating two.

  **Consumer action:** if your app doesn't already list `@cosmicdrift/kumiko-types` as a direct dependency, no action needed — `bun install` resolves the peer automatically from what framework/bundled-features already pull in (verified empirically in this repo's own workspace: `bun install` after this change reported 0 peer-dependency warnings). If you do list it directly (e.g. to build against its type contracts without the full framework import), pin it to the same version as your `@cosmicdrift/kumiko-framework`/`@cosmicdrift/kumiko-bundled-features` release.

## 0.165.0

### Minor Changes

- cf56745: Removes dead public API with zero verified consumers across all Kumiko repos:

  - `@cosmicdrift/kumiko-framework`: `getUnscopedAggregateStreamTenant` (event-store), `createEncryptionProvider`/`EncryptionProvider` (legacy single-key db encryption, superseded by `createEnvelopeCipher`), and the unused `tx` parameter on `executeStream`/`dispatcher.stream()`.
  - `@cosmicdrift/kumiko-types`: `ConfigResolver.getAllWithSource` and the corresponding resolver implementation.
  - `@cosmicdrift/kumiko-dispatcher-live`: `SseFrame`, `iterateSseChunks`, `parseSseFrames` re-exports (internal consumers already import from `./sse-stream` directly).
  - `@cosmicdrift/kumiko-dev-server`: `IdentityStackOptions.providers` (never wired by any app — provider features are appended positionally instead; `GdprStackOptions.providers` is unaffected, it has real callers/tests).

  Adds `toInstant` to `@cosmicdrift/kumiko-headless`'s public barrel (previously an unexported helper duplicated by `@cosmicdrift/kumiko-renderer`'s `formatWhen`).

## 0.164.0

### Minor Changes

- 90b4221: `EventMetadata` gains an optional `idempotencyKey`. When set, `append()` enforces it via a tenant-scoped partial unique index (`metadata->>'idempotencyKey'`) and throws the new `IdempotentAppendConflictError` on a repeat — a second line of defense against duplicate appends when the Redis-backed HTTP idempotency guard misses a retry window. Opt-in only; existing callers are unaffected.

## 0.163.3

## 0.163.2

## 0.163.1

## 0.163.0

## 0.162.0

## 0.161.0

## 0.160.0

## 0.159.1

### Patch Changes

- 6d37eb5: `FileContext`/`FileHandle` move from `packages/framework/src/files/file-handle.ts` to `@cosmicdrift/kumiko-types/file-handle-types`. The old path stays a re-export, so no internal import site changes. `FileStorageProvider` (from `files/types.ts`) is unrelated to these two types and stays put.

## 1.0.0

### Patch Changes

- d0280c8: `@cosmicdrift/kumiko-types` gains its first real content: `identifiers`, `target-ref`, `event-type-map`, and `http-route` move out of `packages/framework/src/engine/types/`. The old paths stay as re-export shims, so no internal import site changes. Framework now depends on `@cosmicdrift/kumiko-types` for these.
- a997cc8: `relations` and `tree-node` move from `packages/framework/src/engine/types/` to `@cosmicdrift/kumiko-types`. The old paths stay as re-export shims, so no internal import site changes.
