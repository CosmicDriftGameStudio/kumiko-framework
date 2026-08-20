---
title: Migration Guide
description: Breaking changes and migration hints for Kumiko upgrades
status: reference
verified: 2026-08-20
---

# Migration Guide

This document lists breaking changes across all bundled features.
Use `kumiko upgrade` to check what's new since your current version.

## 0.202.0

### personal-access-tokens

**personal-access-tokens: `write:create` now requires `currentPassword` (+ `mfaCode` if MFA enrolled) (e91d4cb).**

`personal-access-tokens:write:create` now requires `currentPassword` (verified against the caller's password hash) before minting a token, and rejects when the caller has MFA enrolled and `mfaCode` is missing or wrong — a session cookie alone is no longer enough to stand up a durable API credential. `expiresInDays` now defaults to 90 days instead of never-expiring when omitted (the existing 3650-day cap is unchanged, so a genuinely long-lived token is still possible if requested explicitly). Changing a user's password, or enabling/disabling MFA, now revokes all of that user's live PAT tokens — mirrors the existing session auto-revoke-on-password-change behavior. `run-prod-app`/`run-dev-app` wire the new MFA↔PAT revoke callback automatically when both `auth-mfa` and `personal-access-tokens` are mounted; no app-level change needed for that part.

**Migration:** Apps that already mint PATs (their own client code, scripts, or tests) need to add `currentPassword` to the `create` request payload — this is a breaking change to the `create` request shape despite the minor bump (bundled-features doesn't follow strict semver across its handler schemas yet). If the caller has MFA enrolled, also include a valid `mfaCode`.

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
