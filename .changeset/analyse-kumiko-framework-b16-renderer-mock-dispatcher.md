---
"@cosmicdrift/kumiko-renderer": patch
---

`@cosmicdrift/kumiko-renderer/testing` exports a typed `createMockDispatcher` for component tests.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Typed mock dispatcher for component tests
detail: Component tests built their own dispatcher stubs and cast every handler with `as unknown as Dispatcher[...]`, which hid wrong shapes such as a status store without `getSnapshot`. `createMockDispatcher(options)` from `@cosmicdrift/kumiko-renderer/testing` takes plain handlers for `write`, `query`, `batch` and `stream` (`MockWriteHandler`, `MockQueryHandler`, `MockBatchHandler`, `MockStreamHandler`), answers unset ones with an empty success, starts with `initialStatus` (default `online`) and exposes a writable `statusStore`. Handlers are checked against the dispatcher result types, so no cast is needed. The framework's own renderer, bundled-features and document-designer tests and the in-memory dispatchers of the renderer and recipe e2e fixtures use it.
migration: Apps with local `makeDispatcher` stubs or `as unknown as Dispatcher` casts in tests switch to `createMockDispatcher` from `@cosmicdrift/kumiko-renderer/testing`.
-->
