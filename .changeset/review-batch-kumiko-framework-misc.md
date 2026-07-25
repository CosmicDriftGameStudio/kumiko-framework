---
"@cosmicdrift/kumiko-framework": major
"@cosmicdrift/kumiko-bundled-features": major
"@cosmicdrift/kumiko-types": major
---

Fixes a batch of code-review findings across kumiko-framework/bundled-features/types (PR#1222/1501/1431/1529/1333/1461/1424/1439/1423/1337/1398/1252/1257/1489/1472/1452).

**Breaking:**
- `makeAuthGate(LoginComponent, loginProps, MfaVerifyComponent, MfaSetupComponent)` and `makeSessionAuthGate(...)` (`@cosmicdrift/kumiko-bundled-features/auth-email-password`) now take a single `LoginRouteOptions` object instead of four positional args — the positional signature didn't scale past two optional MFA params. Update call sites to `makeAuthGate({ loginScreen, loginScreenProps, mfaVerifyScreen, mfaSetupScreen })`.

**Fixes (non-breaking):**
- `document-ingest-foundation`'s `documentExtractEntity.pages` column is now `encrypted: true` (stored as serialized JSON in an encrypted `longText` column instead of plaintext `jsonb` — the underlying Postgres column type changes from `jsonb` to `text`) — it held the full extracted text of ingested documents (invoices, IDs, contracts) in plaintext. Apps mounting this feature now need an entity-field-encryption master key configured (same requirement every other PII-encrypted field already has) if they don't already have one. No migration needed: this entity has no writer yet (`#1497` unlanded), so no app has persisted rows against the old `jsonb` shape.
- `reindexEntity()`'s `ReindexEntityResult` gains `wouldIndexRows` — a dry run no longer inflates `indexedRows` (which now stays 0 when nothing was written); also now reports a `failures` entry instead of silently indexing a partial document when a searchable field can't be mapped from the read-table row.
- `UserDataDeleteHook`'s return type now includes bare `void` in the union (previously only `undefined`), so a hook explicitly typed `Promise<void>` (not just a contextually-typed arrow literal) type-checks again.
- `run-forget-cleanup` write-handler's response now includes `incompleteCount`/`incomplete` so operator tooling can see partial-deletion hook results, not just hard failures.
- tenant `invitations`/`members` query handlers: bounded-concurrency (pool-limit 4) PII decrypt instead of a strict sequential loop, and `invitations` no longer decrypts `invitedBy` (a plain userId, never PII-encrypted at write time).
- `packages/framework/src/db/dialect.ts`'s `KUMIKO_NAME_SYMBOL`/`KUMIKO_COLUMNS_SYMBOL`/`KUMIKO_META_SYMBOL` are now imported from `@cosmicdrift/kumiko-types/schema-table-types` everywhere internally instead of being re-declared per call site — `SchemaTable` now also carries `[KUMIKO_META_SYMBOL]`.
- `peerDependencies["@cosmicdrift/kumiko-types"]` changed from `workspace:*` to `workspace:^` in `kumiko-framework`/`kumiko-bundled-features` (a staggered-bump consumer previously got two unresolvable exact peer pins); removed the no-op `peerDependenciesMeta.optional: false`.
- `request-helper`'s `authHeader()` now caches one session id per `user.id` instead of minting a fresh live session on every call — test code asserting on session counts/`massRevoker`/`revokeAllOthers` no longer needs to manually reset session-store state to account for seed plumbing.
- `auth-foundation`'s anonymous-access tenant-resolver/tenant-exists merge no longer casts through `as TenantResolver`/`as TenantExists` — the underlying function types were already structurally compatible.
