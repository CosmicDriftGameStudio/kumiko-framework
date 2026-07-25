---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-types": patch
---

`@cosmicdrift/kumiko-types` moves from a plain `dependency` to a `peerDependency` of both `@cosmicdrift/kumiko-framework` and `@cosmicdrift/kumiko-bundled-features` (kumiko-framework#1438).

**Why:** `@cosmicdrift/kumiko-types` ships identity-sensitive runtime error classes (`VersionConflictError`, `ArchivedStreamError`, `KeyErasedError`, `KeyNotFoundError`, `KeyAlreadyExistsError`) despite its description previously claiming "no runtime code". If a consumer app installs `@cosmicdrift/kumiko-types` directly at a different version than the one framework/bundled-features resolve internally, `instanceof` checks against these classes silently return `false` across the two copies — a `catch (e) { e instanceof VersionConflictError }` in your app code would miss errors thrown from framework's own copy. Declaring it as a peer dependency forces a single resolved copy across the dependency tree instead of silently tolerating two.

**Consumer action:** if your app doesn't already list `@cosmicdrift/kumiko-types` as a direct dependency, no action needed — `bun install` resolves the peer automatically from what framework/bundled-features already pull in (verified empirically in this repo's own workspace: `bun install` after this change reported 0 peer-dependency warnings). If you do list it directly (e.g. to build against its type contracts without the full framework import), pin it to the same version as your `@cosmicdrift/kumiko-framework`/`@cosmicdrift/kumiko-bundled-features` release.
