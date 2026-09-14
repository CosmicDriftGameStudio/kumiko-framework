---
title: Migration Guide
description: Breaking changes and migration hints for Kumiko upgrades
status: reference
verified: 2026-09-14
---

# Migration Guide

This document lists breaking changes across all bundled features.
Use `kumiko upgrade` to check what's new since your current version.

## 0.271.0

### framework-core

**r.step.read.findOne/read.findMany now tenant-filter by default; cross-tenant reads need unsafeAllTenants + escapeHatch (fw#2914).**

`r.step.read.findOne`/`r.step.read.findMany` no longer read through the raw `DbRunner` bound to `ctx.db` (`tenantDbRunner(ctx.db)`, which bypassed every tenant filter). They now call `selectMany(ctx.db, table, where, opts)` — `ctx.db` is a `TenantDb`, so the same `TenantDb.selectMany` tenant filter that `ctx.db` method-form reads already apply now also applies here: own tenant + `SYSTEM_TENANT_ID` reference rows, and a caller-supplied `where.tenantId` outside that scope is narrowed away instead of passed through. Both steps gain an optional `unsafeAllTenants: { reason: string }` argument; when set, the step reads through `ctx.systemDb.unsafeRaw(reason)` (`r.systemScope()` features, already granted by the feature's own systemScope) or `ctx.db.unsafeRaw(reason)` otherwise — the latter throws `AccessDeniedError` unless the write/query handler declares `escapeHatch: { reason }` — and reports an `"unsafe-raw"` escape-hatch audit event, same as any other `ctx.db.unsafeRaw` use. Inside an `r.systemScope()` handler `ctx.db` stays a fail-closed guard, so a read step there without `unsafeAllTenants` still throws `InternalError` (the message now points at `ctx.systemDb`).

**Migration:** No change needed for a read step that only ever reads within the caller's own tenant — it now gets the same tenant filter `ctx.db` method-form reads already had, and a `where.tenantId` for a foreign tenant is silently narrowed to the caller's own scope instead of leaking rows. A read step that intentionally reads across tenants must add `unsafeAllTenants: { reason: "<why the tenant filter cannot apply>" }` to the step AND `escapeHatch: { reason }` (same reason) to the owning write/query handler (or run the step inside an `r.systemScope()` feature, where the grant already exists). No codemod — cross-tenant read-step usage is expected to be rare and needs a real reason per call site.

**systemScope handlers default to a per-tenant+handler rate limit; nested-write refuses a foreign-tenant/foreign-owner parent row (fw#2861).**

`r.systemScope()` write/query/stream handlers that declare no `rateLimit` now default to `{ per: "tenant+handler", limit: 600, windowSeconds: 60 }` — only when `context.rateLimit` is already configured, and never for a SYSTEM-identity caller. `per: "tenant+handler"` (not `"tenant"`) so one hot handler cannot starve every other systemScope handler's shared tenant quota. `RateLimitDeclaration` (`RateLimitOption | RateLimitDisabled`) replaces `RateLimitOption` on `WriteHandlerDef`/`QueryHandlerDef`/`StreamHandlerDef` (and their `*Definition`/inline-options counterparts): `rateLimit: { disabled: true, reason: "..." }` opts a handler out of both the explicit and default limit; the boot validator rejects an empty reason. `enforceRateLimit` (`pipeline/dispatch-shared.ts`) takes a new `isSystemScope: boolean` 5th param; the three dispatch call sites now call it unconditionally. `computeHasRateLimitedHandler`/`wantsL3` stay limited to explicit, non-`disabled` `rateLimit` declarations on purpose. 40 bundled systemScope handlers newly get the default; 7 self-scoped read handlers hit on every page load (traffic scales with signed-in users, not tenant ops) declare `rateLimit: { disabled: true, reason }` instead — `user:query:user:me`, `tenant:query:me`, `config:query:{cascade,values,schema,readiness}`, `delivery:query:preferences` (full per-feature list in the systemscope-rate-limit-nested-ownership changeset). None of the 47 was anonymous-accessible, so no opt-out was required for that reason. Separately, `executeNestedWrite` now refuses to attach nested children to a parent row a custom (non-executor) `:create` handler returned without independently verifying ownership: a new `isForeignTenantParentRow` check refuses a returned row from another tenant (skipped for `r.systemScope()` handlers), and `checkWriteFieldOwnership(parentEntity, parentRow, user)` refuses a same-tenant row whose ownership-bound field does not resolve to the caller — both roll back the whole nested write.

**Migration:** If your app configures a RateLimitResolver (the rate-limiting feature, an explicit `context.rateLimit`, or L1/L2 middleware options that auto-wire one), every `r.systemScope()` write/query/stream handler without its own `rateLimit` is now limited to 600 calls per tenant per handler per 60s for non-SYSTEM callers. Declare an explicit `rateLimit: { per, limit, windowSeconds }` on a handler that legitimately needs more, or `rateLimit: { disabled: true, reason: "..." }` for a per-user self-scoped read whose traffic scales with signed-in users rather than tenant operations (L1 IP limits still apply). Separately, a custom `<entity>:create` handler used under a `nestedWrite: true` relation must return the row it just created for the calling user: returning another tenant's row, or a row whose ownership-bound field(s) do not resolve to the caller, now fails the whole nested write with `access_denied` before any child rows are written.

**`TenantDb.raw` is removed — framework infrastructure gets the connection injected (fw#2860).**

`TenantDb.raw` (`@cosmicdrift/kumiko-types/tenant-db-types`) no longer exists. Framework infrastructure that used to read it — the event-store executor's CRUD verbs, `read.findMany`/`read.findOne`/`unsafeProjectionDelete`/`unsafeProjectionUpsert` engine steps, the entity-convention `crossTenant` handlers, `UncheckedSystemDb.unsafeRaw`, the MSP consumer's per-event `apply()` in `api/server.ts`, and `db/assert-exists-in.ts`'s TenantDb duck-type — now resolves the bound `DbRunner` through a new framework-private module `db/tenant-db-runner.ts` (`bindTenantDbRunner`/`tenantDbRunner`, a `WeakMap<TenantDb, DbRunner>` keyed by the exact object `createTenantDb` built; not re-exported from `db/index.ts` or any package-exports entry, so feature code cannot import it). `asRawClient` (`bun-db/query.ts`) no longer unwraps a `.raw`-shaped TenantDb; it throws when handed one, same as the raw-SQL helpers built on it (`countWhere`, `transaction`, `runInSavepoint`/`runInSavepointIfSupported`, `executeRawQuery`/`executeRawQueryRead`, `upsertOnConflict`, `incrementCounter`, `insertMany`, `deleteManyBatched`) — they no longer accept a `TenantDb` at all. `tenantDbDelegate`'s TenantDb duck-type check no longer looks for `.raw`. `pipeline/projections-runner.ts`'s `runProjections(result, registry, runner)` takes an explicitly-resolved `DbRunner | undefined` (the dispatcher's `resolveDbSource(ctx, tx)`, threaded through `runLifecycle`) instead of reaching into `ctx.db.raw` / `ctx.systemDb.acknowledgeCrossTenant(...).raw` itself; it throws `InternalError` if `result.event` is set but no runner was resolved. `bundled-features/tenant/seeding.ts`'s `fireEntityPostSave`'s optional 4th argument changed from a bare `tenantId` to `{ tenantId, db }` — the caller (already holding a legitimately-declared runner) hands it in instead of the helper trying to pull one out of `context.db`. The boot validator now also rejects a `tenancy: "global"` entity whose owning feature does not declare `r.systemScope()` — a convention write on such an entity would otherwise still dispatch in tenant-mode. `packages/bundled-features/src/jobs/handlers/list.query.ts` switched from `ctx.systemDb.acknowledgeCrossTenant(reason)` to `ctx.systemDb.unsafeRaw(reason)` since it calls `countWhere` directly.

**Migration:** `ctx.db.raw` → `ctx.db.global(table)` for `tenancy: "global"` tables, otherwise `ctx.db.unsafeRaw(reason)` with `escapeHatch: { reason }` on the handler/hook; r.systemScope() features `ctx.systemDb.unsafeRaw(reason)`. Raw SQL helpers (countWhere, transaction, runInSavepoint*, executeRawQuery*, upsert*, incrementCounter, insertMany, deleteManyBatched) no longer accept a TenantDb. Hand-built TenantDb objects passed to the EventStoreExecutor must be created via createTenantDb. `tenancy: "global"` entities must live in an r.systemScope() feature. Custom callers of fireEntityPostSave pass `{ tenantId, db }` as 4th argument.

## 0.270.0

### framework-core

**Boot validator requires every screen to be reachable from the app's nav tree.**

`validateScreens` now rejects a screen that has no own `nav`, no standalone `r.nav()` pointed at it anywhere in the composed feature set, and no resolvable parent list (`listScreenId`, or a rowAction/toolbarAction/drawer navigate target from an `entityList`/`projectionList`, or — for `entityEdit` — a same-entity `entityList`) — unless it declares `dormant: true`. `dormant` (previously only on `CustomScreenDefinition`) is now on every screen type. The resolution logic is the same `resolveNavParentScreen` the renderer's breadcrumb/NavTree already used, moved into `@cosmicdrift/kumiko-framework/engine/screen-helpers.ts` (re-exported through `ui-types`) instead of a second copy, and widened to also recognize toolbarActions and drawer-kind targets, not just entityList rowActions. The check is skipped when the composed feature set registers no nav entries anywhere at all (an isolated feature/recipe/test boot has no nav tree to be orphaned from).

**Migration:** A screen that boots inside an app with at least one nav entry somewhere, but isn't itself reachable, now fails boot with "has no nav entry and no resolvable list". Fix by declaring `listScreenId` (or a rowAction/toolbarAction navigate target from a list screen pointed at it), adding a standalone `r.nav()` for it, or setting `dormant: true` if it's intentionally reachable only via a direct link/redirect or a consuming app's own `r.nav()` (the established pattern for app-placed settings-area screens like `tenant-list`/`user-list`/`tier-admin`/personal-access-tokens' list/`profile`, now applied consistently across bundled-features).

## 0.269.0

### framework-core

**`openToAll: true` is removed — every openToAll grant now requires { reason } (fw#2858).**

`OpenToAllAccessRule` (`@cosmicdrift/kumiko-types/handlers`) no longer accepts `true`; only `OpenToAllDeclaration` (`{ reason: string; personalData?: "tenant-members" }`) satisfies it, so `{ openToAll: true }` no longer type-checks. `isOpenToAllGranted` denies `true` from untyped sources (pattern JSON, Designer) the same way it already denied a malformed object — a bare `true` reaching it now returns `false` instead of granting access. The boot validator (`engine/boot-validator/access-declarations.ts`) rejects an untyped `openToAll: true` access declaration with an error pointing at `{ reason }` instead of registering the handler. The pattern-library Designer access field (`shared-fields.ts` `accessRuleField`) is now a required text input on `access.openToAll.reason` instead of a boolean toggle, so the Designer can only ever produce the object form. `build-config-feature-schema.ts` synthesizes `{ openToAll: { reason: "config key declares the \"all\" role, so every signed-in user of the tenant may read/write it" } }` for a config key whose roles include `"all"`, instead of `{ openToAll: true }`. `boot-validator/nav.ts` and `renderer-web/app/create-app.tsx` switched from `"openToAll" in access` to `isOpenToAllGranted(access)`, so a malformed or `true` rule is no longer treated as a visible screen/workspace. The feature-AST extractor now also extracts `escapeHatch: { reason }` on write/query handlers (`extractors/handlers.ts`) and on `r.hook` options (`extractors/hooks.ts`), round-tripped through render/patch the same way `access`/`rateLimit` already were.

**Migration:** Replace every `openToAll: true` with `openToAll: { reason: "<who may call it and why that is safe without a role>" }`, adding `personalData: "tenant-members"` where the boot validator requires it for a write handler accepting unbound personal data. Pattern-library or Designer-authored JSON that still has `openToAll: true` must be re-saved with a reason before it type-checks or passes boot. `kumiko-upgrade --apply` runs the migrate-open-to-all codemod automatically, rewriting test files to the default reason and listing every non-test site for manual review; run `bun packages/framework/src/scripts/codemod/migrate-open-to-all.ts --test-reason "<text>" <paths>` directly to override the default test reason.

**ctx.queryAs/ctx.writeAs to any identity other than the caller itself need r.systemScope() or escapeHatch (fw#2876).**

The identity-switch gate from fw#2859 now applies to every target, not only SYSTEM (`isSystemIdentitySwitchAllowed` is replaced by `isIdentitySwitchAllowed(caller, asUser, hasGrant)` in `pipeline/system-identity-switch.ts`; `createGatedIdentitySwitch` takes the caller as second argument). Without a grant, `HandlerContext.queryAs`/`writeAs` only accept the caller itself: same `id`, same `tenantId`, same `origin`, equal `claims`, and roles that are a subset of the caller's roles (`sid`, `pat`, `timezone`, `locale` may differ). Any other target — a different user id, a different tenant, extra roles, changed claims, a stripped `origin` — throws `AccessDeniedError` (code `access_denied`, `details.reason` `identity_switch_denied`, no target id/tenant in the error); SYSTEM targets keep `system_identity_switch_denied`. The grant is the same as before: the calling handler's `r.systemScope()` feature or `escapeHatch: { reason }` on the write/query/stream handler, or the hook's own `r.hook(..., { escapeHatch })`. It stays non-transitive, hooks never inherit it, extension hooks and `r.authClaims` hooks have no declaration site (their `queryAs` only reaches the caller itself), and a hook's caller is taken from the dispatcher-built gate, never from `ctx.user`. `JobContext.queryAs`/`writeAs`, top-level `dispatcher.write`/`query`, `ctx.queryAsMember` and `ctx.resolveActiveMembership` are unchanged. `r.step.callFeature({ as })` goes through the gated `ctx.writeAs` and needs the handler's `escapeHatch` for a foreign `as`.

**Migration:** Find every `ctx.queryAs(user, ...)`/`ctx.writeAs(user, ...)` (also via helpers that receive `ctx`, and `r.step.callFeature({ as })`) whose user is not `createSystemUser(...)`. If the user is `event.user`/`query.user` or a copy with fewer roles, nothing to do. If it is another user, another tenant (e.g. `{ ...event.user, tenantId: other }`) or adds roles, declare `escapeHatch: { reason: "<why this handler acts as that identity>" }` on the write, query or stream handler (or on the `r.hook(...)` call), move the call into an `r.systemScope()` feature or a job, or use `ctx.queryAsMember(userId, ...)` for reads as a stored tenant member. Code branching on `details.reason` for these denials must also accept `identity_switch_denied`. Audit at release: bundled-features 0 sites, solon 0, offlot-app 0, kumiko-enterprise 0 (ai-agent tool dispatcher passes the caller itself).

## 0.267.0

### framework-core

**ctx.db.unsafeRaw(reason) gated by escapeHatch, tenancy: "global" invariants, bundled features migrated off ctx.db.raw (fw#2858).**

`TenantDb.unsafeRaw(reason)` returns the unfiltered `DbRunner` only when the calling write or query handler declares `escapeHatch: { reason }` (lifecycle hooks: `r.hook(..., { escapeHatch })`; a hook no longer inherits the handler's grant, same as the #2859 SYSTEM identity-switch gate). Without a declaration it throws `AccessDeniedError`; an empty reason throws `Error`. `r.systemScope()` features keep using `ctx.systemDb.unsafeRaw(reason)`. `TenantDb.raw` stays deprecated until fw#2860. `createTenantDb`'s 7th parameter changed from an `EscapeHatchDeclaration` to `TenantDbGrants` `{ globalWrites?, unsafeRaw? }`; `withUnsafeRawGrant(tenantDb, grant)` rebinds the unsafeRaw grant. `bindHookIdentitySwitchGrant`/`withHookIdentitySwitchGrant` are renamed to `bindHookEscapeHatchGrant`/`withHookEscapeHatchGrant`. Global tenancy: a `tenancy: "global"` entity must declare `systemStream: true` (boot validator + executor) and its create/update payloads may not carry a non-SYSTEM `tenantId`; tenant-mode `insertOne` into a global table with a `tenant_id` column and `db.global(table)` writes with a non-SYSTEM `tenantId` are rejected; `defineUnmanagedTable({ tenancy: "global" })` rejects a `tenant_id` column; new `declareGlobalTenancy(table)` declares a plain `table()` store without `tenant_id` as global. Bundled features: `userEntity` is `tenancy: "global"`, `store_global_feature_state` is declared global, and every bundled `ctx.db.raw` call site now uses `ctx.db.global(table)`, a filtered `ctx.db` method, or `ctx.db.unsafeRaw(reason)` with an `escapeHatch` on the handler. Handlers that call the auth-mfa `mfaStatusChecker`/MFA code verifier callbacks, handlers wrapped by cap-counter `withStockCap` (declares it automatically) and callers of the custom-fields quota/field-access query helpers now need that declaration.

**Migration:** Replace each `ctx.db.raw` use: reads of a `tenancy: "global"` table → `ctx.db.global(table).selectMany/fetchOne(...)`; reads/inserts whose where/values only use the caller's own tenantId → `ctx.db.selectMany/fetchOne/insertOne(table, ...)` (method form); everything else → `ctx.db.unsafeRaw("<what is read/written and why the tenant filter cannot apply>")` plus `escapeHatch: { reason }` on the write/query handler definition or in the `r.hook` options. Generic reasons (todo, legacy, migration) fail infra#788. `kumiko-upgrade --apply` runs the migrate-db-raw codemod automatically, rewriting the global-table and own-tenant cases and listing the remaining sites for manual review. Custom handlers calling `mfaStatusChecker`/the MFA code verifier or the custom-fields query helpers must declare `escapeHatch`. Direct `createTenantDb(..., escapeHatch)` calls pass `{ globalWrites: escapeHatch }` (and `unsafeRaw` if needed). Rename imports of `bindHookIdentitySwitchGrant`/`withHookIdentitySwitchGrant`. `defineUnmanagedTable({ tenancy: "global" })` definitions must drop their `tenant_id` column; `tenancy: "global"` entities must add `systemStream: true`.

## 0.266.0

### framework-core

**`publicIntake` is removed; an openToAll write handler declares unbound personal data with `openToAll: { reason, personalData: "tenant-members" }`.**

`OpenToAllAccessRule.publicIntake` (`@cosmicdrift/kumiko-types/handlers`) no longer exists. `OpenToAllDeclaration` gains `personalData?: OpenToAllPersonalData`, a named union (currently only `"tenant-members"`, exported from `@cosmicdrift/kumiko-framework/engine` and `/ui-types`): signed-in tenant members may write personal data that no owner rule binds to the caller. The deprecated `openToAll: true` form cannot carry it. `validateAccessDeclarations` requires `personalData: "tenant-members"` for a write handler with `openToAll` whose input accepts a personal-data field that is not owner- or self-bound, rejects `personalData` on query and stream handlers, and rejects any other `personalData` value from untyped sources. `openToAll` never admits anonymous callers, so there is no public-intake value; anonymous personal-data intake is tracked separately. The feature-AST extractor reads `openToAll.personalData` and no longer reads `publicIntake`. Bundled `user:update` now declares `openToAll: { reason, personalData: "tenant-members" }`: `userEntity` has no entity-level `access.write`, and privileged actors may edit any user.

**Migration:** Replace `access: { openToAll: { reason: "..." }, publicIntake: true }` (or `openToAll: true, publicIntake: true`) with `access: { openToAll: { reason: "<why any signed-in tenant member may write this personal data>", personalData: "tenant-members" } }`. Handlers whose personal-data fields are owner- or self-bound through the entity's `access.write` need no declaration. A `publicIntake` key left in an untyped access object (pattern JSON, Designer) is ignored, so the handler fails boot until migrated. No known consumer used `publicIntake`.

**The openToAll personal-data boot check now finds personal-data fields nested anywhere in a write handler's input schema.**

`validateAccessDeclarations` (`engine/boot-validator/access-declarations.ts`) previously compared only the top-level keys of a `z.object` input schema (unwrapping `.optional()`/`.nullable()`/`.default()`) against the handler entity's personal-data fields (pii / userOwned / recordOwned); any other schema shape was skipped. It now collects object keys at every depth via `collectZodObjectKeys` (`engine/boot-validator/zod-shape.ts`): through `z.intersection`, `z.union`/`z.discriminatedUnion`/`z.xor`, `.transform()`/`z.preprocess()`/`.pipe()`/codecs, `.optional()`/`.nullable()`/`.default()`/`.prefault()`/`.nonoptional()`/`.readonly()`/`.catch()`/`z.lazy()`, nested objects (e.g. the update shape `{ id, version, changes: {...} }`), arrays, tuples and records. An update handler that accepted the same personal-data field as its create handler used to pass boot while the create handler failed. A schema with more than 10000 distinct nodes (typically a `z.lazy()` getter that returns a new schema on every call) throws at boot instead of looping. Which entity's fields are compared is unchanged: the handler's mapped entity, or every entity of the feature for an unmapped handler.

**Migration:** A write handler with `openToAll` whose input accepts a personal-data field of its entity inside an intersection, union, pipe/transform, nested object (update `changes`), array or record now fails boot like a top-level field always did. Known: kumiko-enterprise kumiko-credit `update` (intersection) and `bauspar:update` (`changes.name`) under `trustDomain: "tenant"` or with an `access` map that grants any role `"all"`. For each affected handler, bind the entity's rows to the caller (owner-binding entry in this release), restrict `access` to roles, or declare `openToAll: { reason: "...", personalData: "tenant-members" }`.

## 0.263.0

### framework-core

**ctx.queryAs/ctx.writeAs with a SYSTEM identity only from r.systemScope(), jobs, or a handler/hook declaring escapeHatch (fw#2859).**

Switching identity to SYSTEM (a SessionUser whose id is SYSTEM_USER_ID or whose roles contain SYSTEM_ROLE, e.g. `createSystemUser(...)`) through `HandlerContext.queryAs`/`writeAs` now throws `AccessDeniedError` (code `access_denied`, `details.reason` `system_identity_switch_denied`) unless the calling handler belongs to an `r.systemScope()` feature or declares `escapeHatch: { reason }`. The grant is looked up per handler type in the registry and never propagates: a handler reached through another handler's `writeAs(SYSTEM)` needs its own declaration for its own SYSTEM switches. `queryAs`/`writeAs` with a non-system user stays ungated and runs under that user's access. `JobContext.queryAs`/`writeAs` and top-level `dispatcher.write`/`query` (es-ops `systemWriteAs`, extraRoutes) stay ungated. Lifecycle hooks no longer inherit the grant of the handler they fire on: `r.hook(type, target, fn, { escapeHatch })` is the per-hook declaration; hooks contributed through `r.extendsRegistrar` are always denied; `r.authClaims` hooks' `queryAs` denies SYSTEM. `escapeHatch` is now also accepted on query handlers (`QueryHandlerDef`/`QueryHandlerDefinition`/`r.queryHandler` options); the boot validator rejects an empty reason there too, and `r.hook` throws at registration on an empty reason. Static boot-time detection of SYSTEM switches is not possible (handlers are closures), so enforcement is at runtime.

**Migration:** Find every `ctx.queryAs(...)`/`ctx.writeAs(...)` whose user is `createSystemUser(...)` or otherwise carries `SYSTEM_ROLE` (also indirectly through helpers that receive `ctx`). For each, add `escapeHatch: { reason: "<which SYSTEM lookup/write and why the caller's own identity cannot do it>" }` to the write or query handler definition that ends up calling it (`r.writeHandler`/`r.queryHandler` options, `defineWriteHandler`/`defineQueryHandler`), or move the logic into an `r.systemScope()` feature or a job when that is the correct owner. Handlers of `r.systemScope()` features need nothing. A lifecycle hook doing a SYSTEM switch through its runtime HandlerContext passes `{ escapeHatch: { reason } }` as `r.hook`'s options (postSave/postDelete: next to `phase`). `escapeHatch` on a write handler also permits `ctx.db.global()` writes. Consumer call sites to audit at release: solon 15, offlot-app 14, kumiko-enterprise 5 `queryAs`/`writeAs` sites.

**Forms are prefilled from URL query parameters only for fields a declarative `navigate` action declares as `params` (fw#2852).**

`buildAppSchema` now derives `urlPrefillFields` per actionForm/secretMint/entityEdit-create screen from every navigate `params` that targets it — entityList/projectionList rowActions, projectionDetail/entityEdit actions, relatedList rowActions, and projectionDetail metrics; a form nothing targets takes nothing from the URL. Previously any query parameter matching a field name was taken, so a crafted link could seed e.g. an IBAN or e-mail field. Declared params keep working. `sensitive` and `format: "password"` fields are still never prefilled — not from the URL, an allowlist, or a handoff.

**Migration:** Code that prefills a form via `nav.navigate` + `nav.setSearchParams` without a declared `params` (known: publicstatus `custom-field-list`, phronexsis `driver-map-node-panel`, kumiko-enterprise ai-agent `openForm` client tool / `agentPrefill=1`) must switch to a declared `navigate` action with `params`, or — for programmatic prefill — to `useNavigateWithInitialValues()` from `@cosmicdrift/kumiko-renderer`. No codemod.

## 0.261.0

### framework-core

**access is required on handler definitions; openToAll accepts { reason } (+ publicIntake) (fw#2855).**

`WriteHandlerDef`/`QueryHandlerDef`/`StreamHandlerDef`.access (`@cosmicdrift/kumiko-types/handlers`), `WriteHandlerDefinition`/`WriteHandlerInput`/`QueryHandlerDefinition`/`StreamHandlerDefinition`.access, `EntityHandlerOptions.access`, and the `r.writeHandler`/`r.queryHandler`/`r.streamHandler` positional `options` param are now required — a handler with no access rule fails to compile instead of silently registering unreachable (previously the boot-validator caught it at runtime). `registerEntityCrud` throws at registration when an enabled verb resolves no access (`write.access`/`read.access`/`verbAccess.<verb>` all unset) — was previously a boot-validator throw. `AccessRule.openToAll` accepts `{ reason: string }` (plus optional `publicIntake: true`); `true` still compiles (deprecated pre-#2855 form, tracked for removal in fw#2854's call-site migration) but a new boot-validator (`engine/boot-validator/access-declarations.ts`) rejects an empty `openToAll.reason`, an empty `escapeHatch.reason`, `publicIntake` on a query/stream handler, and — the main new catch — a write handler with `openToAll` that accepts a personal-data field (pii/userOwned/recordOwned) in its input schema without `publicIntake: true`. Code that read `access.openToAll` as a boolean must switch to `isOpenToAllGranted(rule)` (`@cosmicdrift/kumiko-types/handlers`, also re-exported from `@cosmicdrift/kumiko-framework/engine` and `/ui-types`), which handles both the `true` and `{ reason }` forms.

**Migration:** Add `access` to every handler definition: `r.writeHandler`/`r.queryHandler`/`r.streamHandler` object- and positional-form options, `defineWriteHandler`/`defineQueryHandler`/`definePagedQueryHandler`/`defineProjectionQueryHandler` options, `defineEntityCreate/Update/Delete/Restore/List/DetailHandler` options, and `registerEntityCrud`'s `write.access`/`read.access` (or per-verb `verbAccess`). Replace `openToAll: true` with `openToAll: { reason: "..." }` going forward — `true` still compiles but is deprecated (fw#2854 tracks the 471-site call-site migration; new code should use the object form). A write handler that already used `openToAll` and accepts a PII field now fails boot unless it also declares `publicIntake: true` (any authenticated user may legitimately submit that data) or is restricted to roles instead. Any code reading `access.openToAll` as a boolean must switch to `isOpenToAllGranted(rule)`.

## 0.259.0

### sessions

**sessions:query:user-session:mine returns the paged envelope { rows, nextCursor }; new self-service my-sessions screen (fw#2844).**

The query backs the new `my-sessions` projectionList (open to every signed-in user): the caller's live sessions with a per-row revoke (hidden on the current session) and "sign out all other devices". Exported id SESSION_MINE_SCREEN_ID. Server-side scoping to the caller is unchanged.

**Migration:** Breaking for direct callers of `sessions:query:user-session:mine`: read `data.rows` instead of treating `data` as the array (`nextCursor` is always null). Account-security custom screens built on this query can be replaced by a dashboard with `kind: "screen"` panels on `sessions:screen:my-sessions` and the auth-mfa screens (money-horse#477, publicstatus#435, kumiko-studio#283).

## 0.241.0

### audit

**AuditLogScreen and AuditLogDetailScreen removed; audit-log/audit-log-detail are now declarative screens (fw#2312).**

`audit-log` and `audit-log-detail` render through the generic renderer (`projectionList`/`projectionDetail`) instead of custom React components — the renderer selects a screen by its `screen.type`, not a client component registry, so `AuditLogScreen`/`AuditLogDetailScreen` were dead exports the moment the screen definitions switched. The `payload`/`metadata` fields now use the `format: "json"` field-renderer (see framework changelog) instead of a raw escaped-string dump.

**Migration:** Breaking only if you imported these components directly (no shipped consumer app did). Remove `import { AuditLogScreen, AuditLogDetailScreen } from "@cosmicdrift/kumiko-bundled-features/audit/web"` and any `components: { AuditLogScreen: ..., AuditLogDetailScreen: ... }` entry in your `auditClient()`/renderer setup — the bundled feature registers its own `audit-log`/`audit-log-detail` screens now, nothing left for an app to wire.

### jobs

**JobRunsScreen and JobRunDetailScreen removed; job-runs/job-run-detail are now declarative screens (fw#2312).**

`job-runs`/`job-run-detail` render through the generic renderer (`projectionList`/`projectionDetail`) instead of custom React components — the renderer selects a screen by its `screen.type`, not a client component registry, so `JobRunsScreen`/`JobRunDetailScreen` were dead exports the moment the screen definitions switched. Job triggering moved from an inline control on the old custom screen to a new `job-trigger` `actionForm`, opened via a `kind: "drawer"` `toolbarAction` on `job-runs`. `job-run-detail`'s `logs` field now uses the `format: "json"` field-renderer (see framework changelog) instead of a raw escaped-string dump.

**Migration:** Breaking only if you imported these components directly (no shipped consumer app did). Remove `import { JobRunsScreen, JobRunDetailScreen } from "@cosmicdrift/kumiko-bundled-features/jobs/web"` and any `components: { JobRunsScreen: ..., JobRunDetailScreen: ... }` entry in your `jobsClient()`/renderer setup — the bundled feature registers its own `job-runs`/`job-run-detail`/`job-trigger` screens now, nothing left for an app to wire.

### tier-engine

**TierAdminScreen removed; tier-admin is now a declarative actionForm (fw#2312).**

`tier-engine:screen:tier-admin` is now a declarative `actionForm` (a `reference` field for the tenant, a `select` field for the tier) instead of a custom React component: it dispatches `set-tenant-tier` directly, so the renderer's generic form handles tenant lookup, validation and submit. Two behaviors are intentionally not carried over: the current tier of the selected tenant is no longer shown before submit (declarative forms have no dependent-query support), and the success state no longer names the newly assigned tier (a generic actionForm success doesn't surface write-response data). Both are visible again after a page reload / re-navigation — the assignment itself is unchanged.

**Migration:** Breaking only if you imported `TierAdminScreen` directly (no shipped consumer app did — all reference the screen by its qualified id `tier-engine:screen:tier-admin`). Remove `import { TierAdminScreen } from "@cosmicdrift/kumiko-bundled-features/tier-engine/web"` and any `components: { TierAdminScreen: ... }` entry in your renderer setup — the bundled feature registers the `tier-admin` screen itself now, nothing left for an app to wire.

### user-data-rights

**privacy-center is now a declarative screen; userDataRightsClient's privacyCenter.showDeletion option is removed (fw#2312).**

`privacy-center` is now a declarative `projectionDetail` screen instead of a custom React component: the Restriction and Deletion sections render through the generic renderer (`EditFieldsSection` + `actions: RowAction[]`), preserving the original confirmation dialogs (`RowActionWriteHandler.confirm`) and visibility rules (`visible: {field, eq/ne}`) 1:1. The Export section (Art. 20) stays a custom `EditExtensionSection` — it needs polling + a signed-URL download — registered via the new `ClientFeatureDefinition.extensionSectionComponents` under `EXPORT_SECTION_EXTENSION_NAME`. `PrivacyCenterScreen` is a dead export (the renderer selects the screen by `screen.type`, not the client component registry). The single `status` field now renders through the `enumOption` format instead of the raw enum string; `gracePeriodEnd` is hidden when no deletion is pending instead of showing an empty date. Known UI regression, accepted for this pass: the confirm-dialog title is now always the action's `label` (the renderer hardcodes this) — the original's distinct `dialogTitle` copy and its dynamic composed banner sentence (e.g. "Your account will be deleted on {date}") are gone, replaced by the translated `status` label plus a separately labeled `gracePeriodEnd` date.

**Migration:** A declarative screen is registered once and can no longer be toggled per-app on the client: `userDataRightsClient(options)`'s `privacyCenter: { showDeletion }` option is removed. Move the flag server-side instead — replace `createUserDataRightsFeature({})` with `createUserDataRightsFeature({ privacyCenterShowDeletion: false })` (default `true`) — it conditionally omits the Deletion section and its `request-deletion`/`cancel-deletion` actions from the screen definition. Then drop the now-unused `privacyCenter` option from the matching `userDataRightsClient({ privacyCenter: { showDeletion: false } })` call. Known affected consumer: `money-horse` (`src/app/client-features.tsx:74`).

### user-profile

**user-profile now registers its own profile screen (id user-profile:screen:profile); app-side profile screen registrations must be removed (fw#2312).**

`profile` is now a declarative `projectionDetail` screen bound to `user:query:user:me` instead of a custom React component: change-password and change-email stay `EditExtensionSection` components (re-auth flows a declarative action can't express), account deletion (request/cancel via `user-data-rights`, grace period) is now fully declarative fields + `actions: RowAction[]`, preserving the original confirm dialog and `visible: {field, eq/ne}` toggle 1:1. `userProfileClient()` now registers the two extension-section components via `extensionSectionComponents` instead of exposing a `ProfileScreen` component for apps to place in a `components` map. `ProfileScreen` is a dead export. New exports: `ChangeEmailSection`, `ChangePasswordSection` (the two surviving extension components, importable for tests but not meant to be placed manually). Known UI regression, accepted for this pass (same trade-off as `privacy-center`): the deletion confirm-dialog title is now always the action's `label`; the dynamically composed grace-period banner sentence is gone, replaced by a plain `gracePeriodEnd` date field; there is no cancel-deletion success toast.

**Migration:** The bundled feature now registers the `profile` screen itself (id `user-profile:screen:profile`) — an app's own `profile` custom-screen registration collides on boot with a duplicate short-id error. Delete the app-side registration entirely: `r.screen({ id: "profile", type: "custom", renderer: { react: { __component: "UserProfileScreen" } }, access: { openToAll: true } })` has no replacement to write, just remove the call. If you have an `r.nav({ screen: "profile" })` (or any other reference to the app-local `profile` screen id), repoint it at `"user-profile:screen:profile"`. Also remove `components: { UserProfileScreen: ProfileScreen }` from your renderer/client setup and the now-unused `ProfileScreen` import — the client no longer exposes that component. Known affected consumers (not modified here, out of this PR's scope): `money-horse` (`src/features/money-horse/feature.ts:286-292`) and `offlot-app` (`src/features/account/feature.ts:24-30`) both currently register their own `profile` custom screen this way.

## 0.235.0

### framework-core

**UnprocessableOpts.details can no longer carry its own `reason` key (fw#2460).**

UnprocessableError builds its `details` as `{ ...opts?.details, reason }`, so `reason` was always owned by the ctor's first positional argument — but nothing stopped a caller from also putting `reason` inside `opts.details`, where it was silently overwritten. `UnprocessableOpts.details` is now typed `Readonly<Record<string, unknown>> & { readonly reason?: never }`, so that redundant key is now a compile-time error (TS2322) instead of a silent no-op. This was shipped in #2460 without a changeset or changelog entry, which is what this entry retroactively fixes.

**Migration:** Remove `reason` from any `details: { ... }` object literal passed to `new UnprocessableError(reason, { details: { ...} })` — the value is unchanged, it now flows only through the first positional argument. Run the codemod, or delete the property by hand where it isn't statically removable (the codemod reports those sites with file:line and a reason).

## 0.209.1

### framework-core

**Job runs no longer go through the event store; read_job_runs table renamed to store_job_runs (fw#2243).**

Job runs (jobRun) no longer go through the event store. Every job execution used to append a run-started + run-completed/run-failed event replayed through two inline projections — in the busiest apps this was ~99% of all events ever written, for data nothing else replays or subscribes to. onJobStart/onJobComplete/onJobFailed now write straight into the (renamed) store_job_runs / store_job_run_logs tables, with a new daily jobs:job:retention-cleanup job (retentionDays, default 30) purging old rows so the tables don't grow forever.

**Migration:** Breaking for raw-SQL consumers: the table is renamed read_job_runs → store_job_runs (store_job_run_logs is unchanged). The migration drops read_job_runs outright — old run history is not preserved, it was operational/debug data, not a system of record. Apps that only use the shipped job-runs-screen/jobs:query:* handlers are unaffected; apps with a raw SQL dependency on read_job_runs need a follow-up on their side.

## 0.202.0

### personal-access-tokens

**personal-access-tokens: `write:create` now requires `currentPassword` (+ `mfaCode` if MFA enrolled) (e91d4cb).**

`personal-access-tokens:write:create` now requires `currentPassword` (verified against the caller's password hash) before minting a token, and rejects when the caller has MFA enrolled and `mfaCode` is missing or wrong — a session cookie alone is no longer enough to stand up a durable API credential. `expiresInDays` now defaults to 90 days instead of never-expiring when omitted (the existing 3650-day cap is unchanged, so a genuinely long-lived token is still possible if requested explicitly). Changing a user's password, or enabling/disabling MFA, now revokes all of that user's live PAT tokens — mirrors the existing session auto-revoke-on-password-change behavior. `run-prod-app`/`run-dev-app` wire the new MFA↔PAT revoke callback automatically when both `auth-mfa` and `personal-access-tokens` are mounted; no app-level change needed for that part.

**Migration:** Apps that already mint PATs (their own client code, scripts, or tests) need to add `currentPassword` to the `create` request payload — this is a breaking change to the `create` request shape despite the minor bump (bundled-features doesn't follow strict semver across its handler schemas yet). If the caller has MFA enrolled, also include a valid `mfaCode`.

## 0.201.0

### framework-core

**IdempotencyGuard.check()/.store() gain a discriminated result + token param on top of the 0.198.0 signature (fw#2139).**

Fixes two idempotency-lock races that could let a duplicate request re-run a write handler or silently overwrite a fresher cached result. `waitTimeoutMs` (how long a duplicate request waits for the in-flight one) is now clamped to always exceed `pendingTtlSeconds` (the in-progress lock's own TTL) — previously the defaults (30s lock vs. 25s wait) let a retry give up and re-execute the handler while the original call was still legitimately running. `IdempotencyGuard.store()` now does an atomic compare-and-swap against the exact lock token the calling run acquired (Redis EVAL) instead of an unconditional SET, so a stale, slow-finishing run can no longer stomp the result a reclaiming run already persisted after the lock expired. `IdempotencyGuard.check()` now returns a discriminated `{ status: "cached", result }` / `{ status: "acquired", token }` union instead of `string | null`, and `store()` takes the acquired token as a new parameter.

**Migration:** Layered on top of the 0.198.0 signature change: check() is now check(tenantId, userId, requestId) returning { status: "cached", result } | { status: "acquired", token }; store() is now store(tenantId, userId, requestId, token). Both call sites in this repo (dispatch-batch.ts, the dispatcher test mock) are already updated; any code outside this repo calling IdempotencyGuard directly needs the same update.

**GET /files/:id now sniffs bytes and serves svg/txt/csv/json/md as application/octet-stream instead of inline (fw#2140).**

GET /files/:id served the stored mimeType as Content-Type without verifying it against the file's actual bytes — a client can declare any MIME at upload time, so an attacker could upload real HTML/SVG content and have it served back with a trusted-looking Content-Type from the app origin, enabling stored XSS. Uploads themselves are still accepted regardless of declared MIME (this is unchanged); the fix hardens serving instead. The download route now sniffs the file's magic bytes and only serves the sniffed Content-Type inline when it matches a known-safe binary signature (png/jpeg/gif/webp/pdf) AND matches the declared MIME from upload. Anything else — including a genuine mismatch, or file types with no reliable binary signature such as svg/txt/csv/json/md — is now served as application/octet-stream. This also adds X-Content-Type-Options: nosniff to GET /files/:id, which previously had none.

**Migration:** Breaking for consumers that render uploaded svg/txt/csv/json/md files inline (e.g. an <img src> pointing at GET /files/:id): those now download as application/octet-stream instead of rendering. Route such content through a purpose-built safe viewer if inline rendering is required.

## 0.198.0

### framework-core

**IdempotencyGuard.check/.store signature changed to (tenantId, userId, requestId); SqlExpression is branded (fw#2049).**

Security hardening (audit "Welle 2"): closes a request-supplied-JSON-can-forge-raw-SQL path and a cross-tenant idempotency-cache collision. `SqlExpression` is now branded — only the `sql` template tag and `sql.raw(...)` produce a value the query layer recognizes as raw SQL; an object literal built by hand (`{ kind: "sql-expr", sql: ..., params: ... }`) is no longer treated as raw SQL and gets bound as an ordinary JSON parameter instead, surfacing as a broken query rather than a silent vulnerability. `IdempotencyGuard.check`/`.store` moved from `(requestId)` to `(tenantId, userId, requestId)` so the idempotency cache can no longer be hit across tenants/users by an attacker who guesses or replays a requestId; the Redis key format changed from `${prefix}${requestId}` to `${prefix}${tenantId}:${userId}:${requestId}` with no compatibility shim.

**Migration:** Replace any hand-built SqlExpression object literal with the `sql` tag or `sql.raw(...)`. Any custom IdempotencyGuard implementation, or code calling `.check`/`.store` directly (outside the dispatcher's own runBatch, which already updated), needs the new (tenantId, userId, requestId) signature. On deploy, in-flight idempotent retries older than the request's own retry window may execute a second time — same as a first-ever request, not a correctness issue, just not a cache hit.

**event-store-executor.list() now throws 422 search_adapter_not_wired instead of returning unfiltered results (fw#2032).**

event-store-executor.list() silently dropped payload.search when no SearchAdapter was wired (neither at build time via options.searchAdapter nor at runtime via runtimeOptions.searchAdapter) — the list came back unfiltered, indistinguishable from a real search result. Now throws UnprocessableError (code: "unprocessable", details.reason: "search_adapter_not_wired", details.entity) instead.

**Migration:** Breaking for consumers whose entities are searchable but have no SearchAdapter wired: a search request that used to silently no-op now returns a 422. Wire a SearchAdapter (e.g. Meilisearch) for the entity, or stop marking the field/screen searchable.

**NavIconKey closed union replaces icon?: string on nav/config-mask definitions (fw#2055).**

NavDefinition.icon, ContentCollectionDefinition.nav.icon, ScreenNavSugar.icon and ConfigMask.icon were all icon?: string — any typo (icon: "seting") compiled fine and silently fell back to a dot in the sidebar. New NavIconKey union (@cosmicdrift/kumiko-types/nav-icon, re-exported from @cosmicdrift/kumiko-framework/{engine,ui-types}) types all four against the closed set of keys the web renderer actually registers, so an unregistered icon key is now a compile error at the r.nav()/r.screen({ nav })/config-mask call site instead of a missing icon at runtime. packages/renderer-web's NAV_ICONS map is checked against the same union via `as const satisfies Record<NavIconKey, …>`, so the type and the map can no longer drift.

**Migration:** Breaking for any app that passes an icon key outside the vocabulary in packages/types/src/nav-icon.ts — such a call site will fail to compile after this bump. Fix the typo or add the missing key to both NavIconKey and renderer-web's NAV_ICONS map in the same change.

## 0.195.0

### template-resolver

**ContentEditorProps gains a required id (fw#2001).**

TextBlockEditor's Field wrapping a registered "rich"/"plain" editor pointed its htmlFor at the fixed CONTENT_EDITOR_ELEMENT_ID, which only the never-mounted textarea fallback actually used — the label was disconnected from the real input as soon as a collection declared contentFormat: "rich" or "plain". TextBlockEditor now generates a per-instance id via useId() and passes it to both the Field and the ContentEditor, so the label stays correctly associated and two editors mounted on the same page no longer collide on a shared DOM id.

**Migration:** A custom-registered content editor component now needs to accept and use this id prop, rendering it onto its own focusable root element. Consumers that don't touch the DOM id directly are unaffected. CONTENT_EDITOR_ELEMENT_ID stays exported as a default value for callers that don't need their own generated id.

## 0.194.0

### file-derivatives

**PRESET_VARIANT_NAMES removed from public exports; publicVariantQuery accepts any name.**

The public GET /media/:fileRefId/:variant route now resolves the variant spec from the FileRef's field declaration (createImageField({ variants: {...} })) instead of a fixed spec table, so an app can declare and publicly serve its own variant names, and a field overriding a built-in preset name (thumb/card/hero/full) is served with its own spec instead of the frozen preset size. publicVariantQuery's schema now accepts any variant name (z.string().min(1).max(64)) instead of z.enum(PRESET_VARIANT_NAMES); resolution requires an exact match against the field's declared variants keys, and an unresolvable name answers 404, same as an unknown FileRef. The route's pre-DB path-param gate is now purely syntactic ([a-zA-Z0-9_-]{1,64}) instead of a name allow-list; a known-valid preset name plus a random fileRefId reached the same DB read as any other name, so the list only blocked the cheaper of two equally-costly attacks, and the actual defense is the existing per-IP rate limit and the UUID guard, both unchanged.

**Migration:** PRESET_VARIANT_NAMES only ever named the allow-list this release deletes, so there is nothing to migrate to. thumb/card/hero/full remain as ready-made specs to spread into a field's own variants.

## 0.193.0

### framework-core

**Image fields get named derived variants; ImageFieldDef/ImagesFieldDef.thumbnails removed (fw#1973).**

createImageField now accepts variants: Record<string, VariantSpec> — boot-validated named derived-image specs, served via GET /api/files/:id/variant/:name behind the same tenant + access guard as the download. A request carries only a NAME, never a spec, so no caller can drive an arbitrary render. The edit-form preview loads the first declared variant instead of the original.

**Migration:** ImageFieldDef.thumbnails / ImagesFieldDef.thumbnails are removed — the flag was never read by anything. Replace any reliance on it with a declared variants entry.

## 0.189.0

### framework-core

**createDateField now backs a real Postgres DATE column, round-trips as Temporal.PlainDate (fw#1924).**

type:"date" fields were silently aliased onto the same instant()/TIMESTAMPTZ column as type:"timestamp": reads returned a full ISO instant ("2026-03-15T00:00:00Z"), writes expected a bare "yyyy-mm-dd" string bound to a timestamptz column through the session's TimeZone — both directions were timezone-dependent for what is meant to be a pure calendar-day value. A date field now serializes as "2026-03-15" (Temporal.PlainDate's own toJSON()); a non-form client that Instant-parses a date field's JSON value now throws. Write shape is unchanged (bare "yyyy-mm-dd").

**Migration:** Managed (event-sourced projection) tables: the generator emits DROP TABLE + CREATE TABLE and replays from the event log automatically — factor in replay cost for entities with a large event history. Unmanaged (store_*, direct-write) tables: the generator emits an in-place ALTER TABLE … ALTER COLUMN … TYPE date USING (col AT TIME ZONE 'UTC')::date, anchored explicitly at UTC — do not hand-write a bare ALTER COLUMN … TYPE date without USING, which falls back to Postgres's session-TimeZone-dependent implicit cast.

## 0.177.0

### framework-core

**createMoneyField's amount now converts to/from minor-unit BIGINT storage (fw#1767).**

flattenMoney/rehydrateMoney used to pass the API amount straight into the BIGINT column without the minor-unit (cents) conversion the column's own doc comment always claimed. A decimal amount (e.g. 56799.16) crashed the insert (float into bigint); a plain integer major-unit amount (e.g. 45000 meaning €450.00) was silently stored as 45000 minor units — 100× too small on read-back.

**Migration:** amount is now always major units (ordinary decimal, e.g. 56799.16) on both write and read — DB storage stays exact-integer cents automatically, no caller change needed for that direction. If you already wrote createMoneyField data under the old (unconverted) semantics, multiply stored amounts by 100 before upgrading, or reconcile after — no known production deployment currently persists money-typed data (verified solon and phronexsis are both pre-launch before this merged).

## 0.167.1

### user

**user.locale no longer defaults to "de" (fw#1637).**

The entity-level default contradicted tenant-settings' own "en" default and silently overrode any app or tenant locale configuration for every new user. locale now stays unset until the client or a resolution chain provides one. Consumers that already fall back with `user.locale ?? "en"` are unaffected in shape but now see null instead of "de".

**Migration:** Run `kumiko-schema generate` and apply — the migration emits `ALTER TABLE read_users ALTER COLUMN locale DROP DEFAULT`. Note that DROP DEFAULT only affects future inserts: existing rows keep the "de" the old default wrote, which no user ever chose. Your app therefore splits into pre-bump users on "de" and post-bump users on null, and each group resolves to a different language. Decide deliberately: either keep the old values (and state that pre-bump users stay German), or run `UPDATE read_users SET locale = NULL WHERE locale = 'de'` once so every user follows the same chain — the latter only if no UI ever let users edit the field, otherwise it erases real choices. If your app relied on the implicit German default, set an explicit fallback instead (fw#1653).

## 0.167.0

### crypto-shredding

**Test-only reset helpers moved from /crypto to /testing (fw#1631).**

resetPiiSubjectKmsForTests and resetBlindIndexKeyForTests are no longer exported by the production barrels. The functions did not change — only the export path. Why it matters beyond tidiness: resetPiiSubjectKmsForTests clears the injected KMS, after which encryptForStorage sees no adapter and writes subject-annotated fields in plaintext, with no error and no log. Reachable from a production barrel, that is one stray import away from silent plaintext PII.

**Migration:** Change the import in your test files: `import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-framework/testing"` instead of `.../crypto`. Type-check catches every occurrence; nothing else changes. Apps mounting crypto-shredding typically hit this in every test that configures an InMemoryKmsAdapter.

### framework-core

**resetEntityFieldEncryptionCacheForTests / resetEventPiiCatalogForTests moved to /testing (fw#1631).**

Test-only reset helpers with no owning feature: resetEntityFieldEncryptionCacheForTests left the /db barrel, resetEventPiiCatalogForTests left /crypto. The functions did not move, only their export path.

**Migration:** Import both from "@cosmicdrift/kumiko-framework/testing" instead of "/db" and "/crypto". Relative deep-imports of the defining module are unaffected.

**Six identity-sensitive error classes moved from kumiko-types into kumiko-framework (fw#1616).**

VersionConflictError, IdempotentAppendConflictError and ArchivedStreamError now live in /event-store, KeyErasedError, KeyNotFoundError and KeyAlreadyExistsError in /crypto — the public paths callers already import from. With no classes left in it, kumiko-types is a plain dependency again instead of a peerDependency, which closes the changesets cycle that escalated every minor release to a major.

**Migration:** Only affects direct imports from the removed @cosmicdrift/kumiko-types/event-store-errors subpath: import from @cosmicdrift/kumiko-framework/event-store or /crypto instead. Apps importing from the framework paths need no change.

## 0.166.0

### document-ingest-foundation

**documentExtract.pages: tenantOwned instead of encrypted, and the feature now requires tenant-lifecycle**

`pages` holds the full extracted text of ingested documents (invoices, IDs, contracts) and was `encrypted: true` — app-master-key ciphertext with no erasure subject, so no Art. 17 path could ever make it unreadable. It is now `tenantOwned: true`, which binds it to the tenant subject key that tenant-destroy's eraseSubjectKeys shreds. The feature registers an EXT_TENANT_DATA destroy hook for it, and since tenant-lifecycle hosts that extension point, `document-ingest-foundation` now declares it as a hard requirement — mounting the feature without tenant-lifecycle (plus its own tenant + compliance-profiles requires) makes createRegistry throw (#1621).

**Migration:** Mount createTenantFeature(), createComplianceProfilesFeature() and createTenantLifecycleFeature() alongside documentIngestFoundationFeature. Rows written before this version carry master-key envelope ciphertext that the subject-decrypt path does not recognise — readIngestPages returns [] for them. There is no reencrypt job; if you have existing extracts you care about, decrypt and rewrite them before upgrading.

## 0.165.1

### auth-email-password

**makeAuthGate / makeSessionAuthGate take a single LoginRouteOptions object (fw#1545).**

The four positional args (LoginComponent, loginProps, MfaVerifyComponent, MfaSetupComponent) did not scale past two optional MFA params. Shipped in the stranded 2.0.0 major and carried into the 0.165.1 line.

**Migration:** Rewrite call sites as makeAuthGate({ loginScreen, loginScreenProps, mfaVerifyScreen, mfaSetupScreen }). Type-check catches every occurrence.

## 0.165.0

### config

**Reencrypt job: removed legacy-decrypt path**

The old single-key format (CONFIG_ENCRYPTION_KEY) is no longer supported. The reencrypt job now classifies rows as rotate/current/unrecognized — unreadable rows are counted as failed instead of silently attempted.

**Migration:** If any config values still exist in the old single-key format, re-encrypt them with the current envelope format before upgrading. The job will now throw an error instead of attempting migration.

### user-data-rights

**Export download: removed ?token= query param**

GET /user-export/by-token no longer accepts the token as a query parameter. Only POST body (read from URL fragment) is supported now. Old email links with ?token= in the URL will stop working.

**Migration:** Replace any existing export links that use ?token= in the URL with POST-based links. The token is now only read from the URL fragment (#token), which browsers never send to the server.
