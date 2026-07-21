# @cosmicdrift/kumiko-types

## 0.160.0

## 0.159.1

### Patch Changes

- 6d37eb5: `FileContext`/`FileHandle` move from `packages/framework/src/files/file-handle.ts` to `@cosmicdrift/kumiko-types/file-handle-types`. The old path stays a re-export, so no internal import site changes. `FileStorageProvider` (from `files/types.ts`) is unrelated to these two types and stays put.

## 1.0.0

### Patch Changes

- d0280c8: `@cosmicdrift/kumiko-types` gains its first real content: `identifiers`, `target-ref`, `event-type-map`, and `http-route` move out of `packages/framework/src/engine/types/`. The old paths stay as re-export shims, so no internal import site changes. Framework now depends on `@cosmicdrift/kumiko-types` for these.
- a997cc8: `relations` and `tree-node` move from `packages/framework/src/engine/types/` to `@cosmicdrift/kumiko-types`. The old paths stay as re-export shims, so no internal import site changes.
