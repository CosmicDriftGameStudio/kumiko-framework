---
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

`@cosmicdrift/kumiko-testing/helpers` exports `fakePooledClientFailingWith` for closed-connection retry tests.

<!-- kumiko-changes
feature: testing
type: improvement
title: Typed fake pooled client for closed-connection retry tests
detail: `fakePooledClientFailingWith(failures, row)` returns a `FakePooledClient`, a `RawDbClient` with `options.max` 1 that throws the given errors on its first reads and then answers `[row]`. It records every read in `calls` (`sql`, `params`). Pair it with `captureClosedConnectionError()` to prove that a query helper built on `unsafeReadRetrying` retries. The framework's event-store and projection-rebuild tests and the custom-fields and form-draft tests use it instead of local copies with `as never` casts.
migration: Local fake clients in app retry tests can switch to `fakePooledClientFailingWith`; `calls` is an array, so `calls` counters become `toHaveLength`.
-->
