# @cosmicdrift/kumiko-types

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
