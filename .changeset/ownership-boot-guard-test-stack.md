---
"@cosmicdrift/kumiko-framework": minor
---

`setupTestStack` now runs the subset-invariant half of the ownership boot-validation over the mounted features. Until now `validateOwnershipRules` existed only on the app-boot paths (`createApp`, dev/prod/worker entrypoints, `kumiko schema`), so every test stack was blind to it: a feature with a broken access map came through the whole suite green and failed on the first real boot.

What it enforces, per mounted feature: fw#2639 — a `{ kind: "where" }` rule on `access.read` whose SQL references an outer column unqualified inside a subquery (Postgres binds it to the inner table, the ownership predicate silently becomes a tautology and grants every row); fw#2626 — a `{ kind: "where" }` rule on `access.write`, which can only ever deny because the write path never reaches SQL; and a `from()`-rule whose column does not exist on the entity. All three hold or fail per feature, whatever else is mounted.

What it deliberately does not enforce: the unknown-role and unknown-claim checks. Those resolve a name against the roles and claim keys of the *whole app*, and a test stack that mounts three of forty features cannot answer that question — a role declared by an unmounted feature is not a typo. Both corpora are therefore passed as `undefined` on this path ("cannot be answered here"), not switched off by a flag; `validateBoot` keeps passing the real corpora, so the prod boot is unchanged and still catches those typos.

**This can turn a consumer's green test suite red.** A failing stack throws out of `setupTestStack` with `[Kumiko Ownership] …`, naming the feature, the entity/field scope, and the role. Treat such a failure as a real defect, not as a test-harness regression — the same feature would have failed the next production boot. The fix for the fw#2639 shape is to qualify the column with `${ctx.tableName}`; for fw#2626, replace the where-rule on `access.write` with a `from()`-rule or a `preSave` hook. There is no opt-out flag by design.

Note for suites that deliberately exercise the runtime fail-closed backstop behind these guards: build the stack with a valid access map and install the broken rule afterwards, instead of mounting a feature the boot guard rejects.

The where-rule lint message now also carries the feature name, so a failure in a multi-feature stack points at the owning feature directly.
