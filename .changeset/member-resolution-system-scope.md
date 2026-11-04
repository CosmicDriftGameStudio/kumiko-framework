---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

`r.systemScope()` queries work again under `ctx.dispatch.queryAsMember`: the resolved member gets a READ ONLY `ctx.systemDb`.

<!-- kumiko-changes
feature: framework
type: fix
title: systemScope queries under queryAsMember get a read-only systemDb
detail: Since the member-resolution hardening, `applyMemberResolutionReadOnly` removed `ctx.systemDb`, so every `r.systemScope()` query reached via `ctx.dispatch.queryAsMember` failed (for example `user:me`). A resolved member principal now gets `createSystemDbView` instead: `acknowledgeCrossTenant` reads run in the READ ONLY transaction, `unsafeRaw` follows the `memberReadOnly` denial, and `outsideTransaction` has no source and throws. `crossTenantReads` and `db.outsideTransaction` stay removed. All other principals are unchanged.
-->
