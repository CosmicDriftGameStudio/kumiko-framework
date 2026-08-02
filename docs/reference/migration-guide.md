---
title: Migration Guide
description: Breaking changes and migration hints for Kumiko upgrades
status: reference
verified: 2026-08-02
---

# Migration Guide

This document lists breaking changes across all bundled features.
Use `kumiko upgrade` to check what's new since your current version.

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
