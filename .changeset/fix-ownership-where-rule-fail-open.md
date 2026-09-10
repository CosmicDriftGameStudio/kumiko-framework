---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

fw#2639: two silent failure modes in the ownership API are now loud.

**1. An unqualified column in a `where`-rule no longer fails open.** A `{ kind: "where" }` rule hands the framework raw SQL. If the author writes an unqualified column inside a correlated subquery, Postgres binds it to the innermost table instead of the outer row — the intended predicate collapses into a tautology (`t.x = t.x`) and the rule hands out *every* row instead of none. Nothing caught that: no boot check, no runtime warning, and a test that only asserts "own subject sees its own rows" stays green.

The framework now lints the SQL a `where`-rule produces and throws instead of splicing a tautology into the query. Two shapes are rejected: a literal self-comparison (`a = a`, `t.a = t.a`), and — whenever the fragment contains a subquery — any *unqualified* identifier that names a column of the outer table. Qualify it with the outer table (`${ctx.tableName}.entity_id`), which is what `WhereRuleContext.tableName` has always been for. String literals and SQL comments are stripped before the check, so a column name mentioned in either is not flagged.

The lint runs twice: as a **boot-time probe** in the boot validator (so a broken rule fails the app's start rather than waiting for a request from the one role that happens to use it) and as a **runtime backstop** in `buildOwnershipClause`, which covers rules the boot probe cannot evaluate (a rule that reads real claims off the session user throws on the probe user and is skipped there). A rule with a subquery that references only qualified columns is unaffected; so is a plain unqualified predicate with no subquery (`owner_id = $1`).

This is deliberately fail-closed and default-on: a broken ownership rule now stops the boot or the request instead of quietly granting universal read access. It has no opt-out — a fail-open guarded by a flag nobody sets is not a fix.

**2. GDPR `forget` is no longer silently denied by `access.write`.** `entity.access.write` is read not only by business write paths but by the executor's generic `delete`/`forget`/`restore` verbs. If the rule's role map did not cover the role the Art. 17 erasure pipeline runs under, `forget()` returned an `ownership_denied` failure that the calling erasure hooks dropped on the floor: the subject key was never shredded and Art. 17 was believed fulfilled rather than fulfilled.

`forget()` now bypasses the entity write-ownership check for the framework system user (`SYSTEM_USER_ID` **and** the `system` role — a tenant-defined role merely *named* `system` is still denied): erasure runs as the platform operator, not as a row owner, and a per-role ownership map can never sensibly cover it. `delete()`, `restore()`, `create()` and `update()` are unchanged.

On top of that, the bundled Art.-17 delete hooks (`config-value`, `file-ref`, `notification-preference`, `tenant-invitation`, `user-mfa`) now assert the erasure result instead of ignoring it. A `not_found` stays a benign no-op (the row is already gone); every other failure throws so the erasure run fails visibly instead of reporting success it did not achieve.
