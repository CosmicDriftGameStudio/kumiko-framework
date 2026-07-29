---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

`packaging`: the six identity-sensitive error classes moved out of `@cosmicdrift/kumiko-types` into `@cosmicdrift/kumiko-framework` — `VersionConflictError`, `IdempotentAppendConflictError` and `ArchivedStreamError` to `/event-store`, `KeyErasedError`, `KeyNotFoundError` and `KeyAlreadyExistsError` to `/crypto`. Those are the public paths callers already import from, so nothing moves for consumers; the `@cosmicdrift/kumiko-types/event-store-errors` subpath is gone.

With no classes and no local `Symbol()` left in it, `kumiko-types` no longer needs the single-copy guarantee a peerDependency buys, and framework/bundled-features declare it as a plain dependency. That closes the changesets cycle where a peer-dependent bump escalated every minor release to `1.0.0`.
