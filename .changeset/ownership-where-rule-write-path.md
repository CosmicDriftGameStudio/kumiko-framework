---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": patch
---

fw#2626: `{ kind: "where" }` ownership rules are now rejected on `access.write` at boot instead of misbehaving at request time.

A where-rule hands the framework raw SQL, and only the read path ever runs SQL (`buildOwnershipClause`). Write access is decided in memory against the concrete row (`userCanCreateFieldRow` / `userCanWriteFieldRow`), and a create has no row to run a predicate against at all — so a where-rule on a write map can never do anything but deny. Nothing said so, and the two sibling helpers disagreed about *how* it failed: `userCanWriteFieldRow` skipped the rule and denied silently, while `userCanCreateFieldRow` passed it to `matchesRule()`, which throws — every create against such an entity ended as a 500. The comment claiming the boot validator rejected the shape described a check that did not exist.

**Boot validation now fails hard** on a where-rule in `entity.access.write` or any `field.access.write`, naming the role, the feature and the alternative (`from("user:id", "ownerId")` / `from("claim:<feature>:<key>")`, or a `preSave` hook in the write handler). `access.read` is unchanged — where-rules stay fully supported there, including the fw#2639 boot probe that lints their SQL.

**`userCanCreateFieldRow` now fails closed** like its update/delete sibling instead of throwing, so an access map assembled outside `validateBoot` denies with `ownership_denied` (422) rather than a 500. This is the runtime backstop, not the fix — the boot guard is.

There is no opt-out and no flag: an ownership rule that can only ever deny is a configuration error, not a mode. No consumer used the shape, so nothing that boots today stops booting.

The build-time guards in `createNotesHistoryFeature`/`createTagsFeature` stay — they fire earlier and name the `ownership` option instead of an entity scope; their messages now point at the framework-level rejection.
