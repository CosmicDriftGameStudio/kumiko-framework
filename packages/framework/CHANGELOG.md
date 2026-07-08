# @cosmicdrift/kumiko-framework

## 0.130.1

## 0.130.0

## 0.129.0

### Minor Changes

- 3247676: Add `registerEntityCrud()` to bundle entity registration and standard CRUD handlers with explicit access and per-verb opt-out.

## 0.128.0

## 0.127.0

### Minor Changes

- f5d37a1: Harden admin operator UI: stricter boot i18n/entityList validation, job run logger wiring, audit/job filters, shell breadcrumbs, and bundled entityList/i18n standards.

## 0.126.0

### Minor Changes

- 0c482c3: tenant-lifecycle: staged tenant destroy runner with auth 410 gate.

  fix(renderer-web): register palette, link and share in NAV_ICONS.

  fix(tenant): align members nav label with tenantClient bundle (`tenant.nav.members`).

## 0.125.2

## 0.125.1

## 0.125.0

## 0.124.0

## 0.123.3

## 0.123.2

## 0.123.1

## 0.123.0

## 0.122.5

## 0.122.4

### Patch Changes

- 2dd0d9e: `runSchemaCli` (the standalone schema CLI used by `kumiko-schema` and the
  `migrate-db` deploy initContainer) now installs the Temporal polyfill before
  running any subcommand. Without it, a projection rebuild triggered by
  `schema apply` threw `ReferenceError: Temporal is not defined` on any
  runtime lacking native Temporal — deterministically, since `runProdApp`/
  `runDevApp` install the polyfill at boot but the standalone CLI never goes
  through that boot path. The crash left the triggering migration recorded as
  applied with its rebuild never retried, silently emptying the affected
  projection tables.

## 0.122.3

### Patch Changes

- 1693324: fix(rebuild): fence projection rebuilds against a stale registry (#835)

  `rebuildProjection` and the MSP rebuild now abort — inside the rebuild tx,
  before building the shadow — when the live table's column names do not match
  this process's `EntityTableMeta` (`assertLiveColumnsMatchMeta`). Previously a
  pod still running the previous build (rolling deploy) could pick up an async
  rebuild job and swap in a shadow built from stale meta, silently dropping a
  freshly-migrated column (#494 recurrence class). The rebuild now fails loud
  with the differing columns in the error; retrying from a pod whose code
  matches the migrated schema succeeds.

## 0.122.2

### Patch Changes

- a9a6d80: Event-Consumer-Dispatcher schreibt keinen Cursor-Heartbeat mehr wenn ein Poll-Tick
  keine neuen Events findet — verhindert unbegrenztes WAL-Wachstum bei idle Consumern.

## 0.122.1

### Patch Changes

- 8665f63: fix(schema): `kumiko schema generate` no longer emits a projection-rebuild marker for a pure additive nullable `ADD COLUMN`.

  Such a column is an in-place ALTER that already brings the managed table to the target state (same reasoning #181 applied to index-/default-/nullability-only changes). Emitting a rebuild marker anyway triggered a full truncate+replay whose shadow-swap could **drop the freshly migrated column** — the rebuild runs from the rebuilding process's registry meta, so on a rolling deploy an older pod (meta without the new column) rebuilds the projection without it → phantom migration (recorded applied, column physically absent) → boot drift-check crash. Same class as `0008_add_pending_deletion_request_id` (read_users) / #494 / #835.

  Rebuild markers are now emitted only when the generated SQL actually recreates the table (`managedChangeRequiresRecreate`: dropped column, NOT NULL without default, unique index, type/nullability change). If a new additive column genuinely needs value-backfill from historical events, opt in explicitly by hand-adding a `NNNN_<name>.rebuild.json` next to the migration.

  Note: this closes the additive-column path. The underlying rolling-deploy race (a stale-registry pod can still wipe columns during a recreate-triggered rebuild) is tracked separately.

## 0.122.0

### Minor Changes

- e069b64: Projection rebuilds no longer replay events of archived streams (Marten-aligned).
  `archiveStream` thereby becomes the documented healing tool for stranded
  aggregates from historical eventless read-side writes: archive the aggregate
  whose live row is gone and the rebuild stops resurrecting it or colliding on
  unique indexes (fw#832). The #443 ground-truth count applies the same filter.

### Patch Changes

- 446f933: Expose the logging module as a package subpath:
  `import { createLogger, type Logger } from "@cosmicdrift/kumiko-framework/logging"`.
  Consumer apps no longer need `console.*` fallbacks with biome-ignore comments (fw#825).

## 0.121.1

### Patch Changes

- 0af1fe1: fix(schema): reference-Entity-Felder behalten entity/labelField/multiple in der Client-Schema-Serialisierung

  `buildAppSchema.projectField()` whitelistete für `reference`-Felder nur
  `type`/`required`/`sortable`/`filterable`/`default`/`options` — `entity`,
  `labelField` und `multiple` fielen aus dem serialisierten `window.__KUMIKO_SCHEMA__`
  heraus. Dadurch bekam der Client-Renderer ein reference-Feld ohne Target-Entity:
  der `ReferenceInput` baute die Options-Query als `<feature>:query::list` (leeres
  `refEntity`) → 404 → das Dropdown blieb leer, obwohl die referenzierte Entity Rows
  hat. Betraf jedes reference-Feld in einem `entityEdit`-Screen (actionForm-Fields
  sind nicht betroffen — Screens werden verbatim serialisiert).

## 0.121.0

### Minor Changes

- b679dc1: Zero-downtime platform-KEK rotation (#818 step 7). `PgKmsAdapter` now understands KEK generations along the existing `kek_version` column: `kekVersion` names the active KEK's generation (new wraps carry it), `previousKeks: { <version>: <base64Kek> }` keeps not-yet-rewrapped rows readable during the rotation window. A row wrapped with an unconfigured generation fails loud as a CONFIG error — never mistaken for a shredded subject. New `rewrapSubjectKeys({ databaseUrl, fromKeks, toKek, toKekVersion, batchSize?, dryRun? })` migrates the estate: unwrap with the old generation's KEK, wrap with the new one, bump `kek_version` — idempotent, erased tombstones untouched, the UPDATE is guarded on the old version so concurrent fresh writes on the new generation are never clobbered. Rotation procedure: runbook `kek-rotation.md` (kumiko-platform).

## 0.120.0

### Minor Changes

- 29fbdc5: `backfillEventPiiEncryption(db, registry, { batchSize?, dryRun? })` (#799): one-time in-place re-encrypt of pre-KMS plaintext PII in `kumiko_events` — entity lifecycle payloads (created / updated changes+previous / deleted/forgotten/restored previous) and catalogued custom events (`defineEvent piiFields`). Idempotent (`kumiko-pii:` values pass through); already-forgotten subjects get `[[erased]]` instead of a freshly minted key, detected via KMS tombstone (KeyErasedError) or the stream's `*.forgotten` event (pre-KMS forgets). Snapshots of touched aggregates are dropped. Run the projection rebuilds afterwards — `applyEntityEvent` materializes ciphertext plus blind-index columns, keeping login-by-email alive. Also new: `registry.getAllEntities()`.
- c22b711: PII on custom-event payloads (#799). `r.defineEvent(name, schema, { piiFields: { recipientAddress: { subjectField: "recipientId" } } })` declares payload fields that are encrypted under the owning user's DEK (crypto-shredding). Enforcement lives in the low-level event-store `append()` — the single write funnel — so `ctx.appendEvent`, MSP-apply AND out-of-dispatcher writers (delivery attempt-log, jobs run-logger) are all covered; the stored event and the returned echo carry ciphertext, keeping inline projections and rebuilds identical. A null subject field (system cron runs, recipient-less attempts) stays plaintext — there is no user key to shred. Misconfigured `piiFields` (unknown field/subjectField) throw at feature-definition time.

  Bundled features annotated: `delivery:event:attempt`.`recipientAddress` (subject = recipientId) and `jobs` `run-started`.`payload` (subject = triggeredById); the pseudonymous fk ids stay plaintext. `delivery log.query` and `jobs list/details` decrypt for display — a forgotten subject shows `[[erased]]`. This makes the events-only aggregates from #797 Art.-17-capable: user-forget erases the DEK, historical delivery addresses and job payloads become unreadable without touching the append-only stream. New exports: `encryptPiiValueForSubject`, `configureEventPiiCatalog`/`configuredEventPiiCatalog`/`encryptEventPayloadPii` (framework/crypto).

## 0.119.0

### Minor Changes

- b01a4d2: Blind index for PII equality lookups + hard PII boot gate (#818, PRs #819/#821/#822/#823 + this one).

  **BREAKING for apps that mount PII-annotated features (user, tenant, sessions, …) without a KMS:** `runProdApp` now ABORTS boot instead of warning. Either wire `kms: createPgKmsAdapter({ databaseUrl, platformKek })` (plus `blindIndexKey`, env `KUMIKO_BLIND_INDEX_KEY`) or acknowledge explicitly with `allowPlaintextPii: "<reason>"` until your KMS is provisioned. Apps with their own `r.unmanagedTable` stores carrying subject annotations must encrypt on write (`encryptForDirectWrite`) and declare `piiEncryptedOnWrite: true`, or boot fails.

  New: `lookupable: true` on pii text fields maintains an HMAC blind-index column so equality lookups (login by email, dedup checks, invites, password reset) keep working on encrypted columns — query compilers rewrite `eq` filters to `(col = $1 OR col_bidx = $2)`, rollout-neutral for plaintext legacy rows. `user.email` and `tenant-invitation.email` are lookupable; `api-token.name` is `userOwned`; `config.userId`/`notification-preference.userId` are declared `allowPlaintext` (pseudonymous FKs). All bundled read paths that hand stored PII to mails, responses, comparisons or lookups decrypt via the new `decryptStoredPii` helper (13 fixed call sites — with a KMS active, all three invite-accept branches and password-reset mails were previously broken). GDPR exports decrypt every `kumiko-pii:` value centrally. Runtime tripwires: a PII ciphertext in a JSON API response is a loud 500 in dev/test and redacted+logged in prod; outgoing mail to a ciphertext recipient is always refused. Executor write-response echoes (`event.payload`) now carry plaintext (the persisted event log is unchanged). `runDevApp` accepts `kms` + `blindIndexKey` to exercise the full crypto path locally.

- 53da660: Crypto-shredding phase D: forget wire. New `crypto-shredding` bundled feature with the `forget-subject` operator command (DPO/SystemAdmin) — erases a user/tenant subject key and appends a `subject-forgotten` audit event. `user-data-rights` forget-cleanup now erases the user's subject key inside the per-user sub-tx (crash-safe, before the status flip). Fixes `list()` returning ciphertext for camelCase encrypted/pii fields and caching plaintext rows.
- 6ffb71e: Crypto-shredding phase C — event-store PII envelope engine (#724): fields annotated `pii` / `userOwned` / `tenantOwned` are encrypted with the erase subject's DEK at the same executor hook points as `encrypted: true`. Storage format `kumiko-pii:v1:<subjectKey>:<base64(iv|tag|ct)>` names the subject inline; event payload AND projection row carry ciphertext (live == rebuild by construction), legacy plaintext passes through on read. Subject keys are created on first write; reads after `eraseKey` render the `[[erased]]` sentinel; writes to an erased subject fail. `runProdApp({ kms })` wires the engine — without an adapter it stays off (plaintext, pre-phase-C behavior) and boot warns; the hard gate ships with the prod-grade PgKmsAdapter (phase E). Also: `forget()` now re-encrypts `previous` like `delete()` (plaintext of encrypted/pii fields no longer lands in the forgotten event), `userOwned.ownerField` accepts text fields (ES userId-by-convention), and `user-session.ip/userAgent` + `tenant-invitation.invitedBy` annotations now name the referenced user as their subject.
- 02670c9: PgKmsAdapter: production subject-key storage for crypto-shredding. Subject DEKs live KEK-wrapped (AES-256-GCM envelope) in a dedicated Postgres cluster; erase leaves an audit tombstone (erased_at/erased_by/erase_reason) without key material. Wire via `runProdApp({ kms: createPgKmsAdapter({ databaseUrl, platformKek }) })`.

## 0.118.0

### Minor Changes

- c5ed4f0: Crypto-shredding phase B — subject resolver + request DEK cache (#724): `resolveSubjectForField` maps a pii-annotated field to its erase subject (`userOwned` owner ref > `tenantOwned` row/write-time tenant > `pii` self); an annotated field whose row cannot name its subject throws `SubjectResolutionError` instead of silently staying plaintext. `collectPiiSubjectFields` precomputes the encrypt-relevant field set per entity. `createRequestKmsCache` caches unwrapped DEKs per request for local-key adapters, with `invalidate()` as the subject-forgotten hook.

## 0.117.0

### Minor Changes

- e5bae38: Crypto-shredding phase A — kms-adapter foundation (#724): new `@cosmicdrift/kumiko-framework/crypto` module with the `KmsAdapter` contract (user/tenant `SubjectId`, `local-key` vs `remote-crypto` capability modes for the later Vault transit adapter, `KeyErased`/`KeyNotFound`/`KeyAlreadyExists` errors) plus `InMemoryKmsAdapter` and a reusable adapter contract test suite. Erased subjects keep a tombstone — `createKey` after `eraseKey` throws, so forget cannot be undone by re-keying. `runProdApp({ kms })` exposes the adapter as `ctx.kms` and health-gates boot (an app configured for crypto-shredding refuses to start against an unreachable key store). No behavior change for apps that don't pass the option.

## 0.116.1

## 0.116.0

## 0.115.1

### Patch Changes

- 7054c74: Boot-validator V3: warn when an entity has pii/userOwned-annotated fields but no feature registers an EXT_USER_DATA export/delete hook for it (Art.15/20/17 coverage gap). Runs only when user-data-rights is mounted.

## 0.115.0

## 0.114.0

## 0.113.1

## 0.113.0

### Minor Changes

- ba5053b: New `projectionList` screen-type — like `entityList`, but bound to an explicit query instead of an entity.

  `entityList` derives its list-query from the screen's own feature (`<feature>:query:<entity>:list`), so a screen can't list a projection owned by another feature. `projectionList` takes a fully qualified `query` verbatim (e.g. `ledger:query:schedule:list`) — cross-feature by design, and works over any read-model/aggregation, not just entities. Columns carry explicit labels (no entity to derive from), there's no auto create-navigation, and row interaction is explicit via `rowActions`. Reuses the entityList table machinery (RenderList/computeListViewModel) via a synthetic-entity shim; `entityList` is untouched. v1 renders the query rows with navigate row-actions/row-click (no server sort/pagination — a projection query has no guaranteed paged contract).

## 0.112.1

### Patch Changes

- 0b9eb9a: fix(auth): close two low-severity auth findings (#774)

  - Login no longer short-circuits before the argon2 verify on unknown emails: a
    fixed dummy hash is verified on the miss path so response latency no longer
    reveals whether an email is registered (timing enumeration).
  - Magic-link screens (reset, verify, signup-confirm, invite-accept) now scrub
    the `?token=` param from the URL via `history.replaceState` after reading it,
    so single-use tokens don't linger in browser history / Referer. New
    `useUrlToken` hook replaces the raw `parseUrlToken` read in those screens.

## 0.112.0

### Minor Changes

- 3714822: Forget/export delete-hooks now receive the app registry (`UserDataHookCtx.registry`).

  A DSGVO forget hook that must erase CHILD read-model rows past the entity's own row — m:n join projections, per-parent detail projections — now gets the app registry so it can run those custom projections for the executor's `<entity>.forgotten` event via `runProjectionsForEvent(result.data.event, ctx.registry, ctx.db)`. `executor.forget` purges only the entity's own projection, and the forget pipeline is a job (not a dispatched command), so the dispatcher's post-command projection pass never fires — without this the cascade was unreachable and child read-model rows were orphaned on a live forget.

  Migration: hook-ctx constructors now pass `registry`; the framework's own `runForgetCleanup`/`runUserExport` already do. Custom code that constructs a `UserDataHookCtx` must add `registry`.

## 0.111.0

### Minor Changes

- 340acef: Unified encryption: encrypted config keys and encrypted entity fields now use
  the same versioned envelope mechanism as `ctx.secrets` (DEK per value, KEK from
  `KUMIKO_SECRETS_MASTER_KEY_V<n>`), making key rotation possible everywhere.

  - New `createEnvelopeCipher` (framework/secrets): JSON `StoredEnvelope` in TEXT
    columns, format detection, decrypt-only legacy fallback, shared DEK cache.
    `MasterKeyProvider.wrapDek/unwrapDek` gained an optional `KeyScope` param
    (BYOK hook; env provider ignores it).
  - Config: `ConfigResolverOptions.encryption` → `cipher` (EnvelopeCipher);
    reading an encrypted key without a cipher now THROWS instead of silently
    returning the ciphertext as the value. New manual `config:reencrypt` job
    migrates legacy `CONFIG_ENCRYPTION_KEY` rows and rotates old kekVersions.
  - Entity fields: `ENCRYPTION_KEY` singleton replaced by boot-injected cipher
    (`configureEntityFieldEncryption`); executor encrypt/decrypt paths are async;
    boot validation now probes keyring availability (malformed keys fail at
    boot). GDPR export decrypts encrypted fields (or emits an explicit
    `[encrypted:unavailable]` marker) instead of leaking ciphertext.
  - run{Prod,Dev}App auto-wire the cipher + `masterKeyProvider` from the
    environment; `CONFIG_ENCRYPTION_KEY` / `ENCRYPTION_KEY` remain supported as
    decrypt-only fallbacks until the reencrypt job has run.
  - `createEncryptionProvider` is deprecated (legacy decrypt-only). Tests:
    `createTestEnvelopeCipher` / `createTestMasterKeyProvider` in
    framework/testing.

  Migration: provision `KUMIKO_SECRETS_MASTER_KEY_V1`, deploy, run
  `config:reencrypt`, verify `failed: 0`, then drop the legacy env keys.

## 0.110.0

### Minor Changes

- 3fa4673: Brand TenantDb method-form writes (#742). `ctx.db.insertOne`/`updateMany`/`deleteMany` now reject a branded `EntityTable` at compile time, exactly like the free-function `insertOne(db, table, …)` helpers already do — closing the gap where a projection could still be written past its event stream via the method form (a rebuild would wipe such eventless rows). Reads (`selectMany`/`fetchOne`) are unchanged, and raw `pgTable`s plus unmanaged entity metas stay writable. The only sanctioned direct-write bypass remains the `@cosmicdrift/kumiko-framework/testing` seam (`seedRow`/`seedRows`/`updateRows`/`deleteRows`).

  Migration: route production method-form writes on managed entities through `createEventStoreExecutor(...).create/.update/.delete/.forget`; in tests, use the testing seam (or hold a throwaway fixture at the unbranded `TableColumns` view).

## 0.109.0

## 0.108.0

## 0.107.0

### Minor Changes

- 64ff082: Custom-field values now survive a host-entity projection rebuild (#759).

  - New registrar API `r.extendEntityProjection(entityName, { sources?, apply })`: merges extra apply handlers (+ extra event sources) into the entity's implicit projection so `rebuildProjection` replays event types that a bundled extension materializes into the host entity's table. Rebuild-only — the inline runner keeps skipping implicit projections, live delivery stays with the extension's MSP.
  - `ProjectionDefinition.extraSources`: additional aggregate-types included in the rebuild event filter while `source` keeps meaning "the owning entity" (soft-delete-cleanup et al. unchanged).
  - `wireCustomFieldsFor` registers its `customField.set`/`.cleared`/`fieldDefinition.deleted` applies through the new API. Previously a schema-migration rebuild reset every `customFields` jsonb to `{}` with no recovery path; the table-less custom-fields MSP was categorically excluded from `rebuildMultiStreamProjection`.

- 3ff6025: Poison-event quarantine for projection rebuilds (#760).

  - A single historical event whose apply handler throws no longer has to permanently block a rebuild. Opt-in quarantine mode confines each apply to a driver-native savepoint: the poison event is rolled back, recorded into the new `kumiko_rebuild_dead_letters` table, and the replay completes. `RebuildResult.eventsSkipped` reports the count.
  - Single-stream: `RebuildDeps.errorPolicy.skipApplyErrors` (per run). Default stays strict — first throwing apply aborts the rebuild.
  - MSP: `MspErrorMode.rebuild.skipApplyErrors` (falling back to `continuous`) is now honored by `rebuildMultiStreamProjection` — the option was declared but previously never implemented for rebuilds.
  - New ops surface: `listRebuildDeadLetters(db, { projectionName })`, `runInSavepoint(tx, fn)` (bun-db).
  - The `jobs:job:projection-rebuild` payload accepts `skipApplyErrors: true` for operator-triggered quarantine runs.

## 0.106.0

### Minor Changes

- 7944923: Make direct writes on event-sourced projections a compile error.

  `EntityTable` is now branded (a phantom `unique symbol`), and the write helpers
  `insertOne` / `insertMany` / `updateMany` / `deleteMany` / `deleteManyBatched` /
  `upsertOnConflict` / `upsertByPk` / `incrementCounter` reject it: a managed
  projection is writable only through the executor (event → rebuild-safe). Reads
  are unchanged.

  **Breaking:** any call that wrote a managed projection directly (e.g.
  `deleteMany(ctx.db, myEntityTable, …)`) is now a type error. Migrate it to the
  entity executor (`createEventStoreExecutor(...).update/.delete`), or — for a
  table that is deliberately not event-sourced — declare it via `r.unmanagedTable`
  so it is a plain `EntityTableMeta` (unbranded).

  New: custom projection applies (`r.projection` / `defineApply`) receive the
  projection table as a third argument — write through it instead of a closed-over
  constant. Existing 2-arg applies keep working. Tests seed projection state via
  the new `@cosmicdrift/kumiko-framework/testing` seam
  (`seedRow`/`seedRows`/`updateRows`/`deleteRows`).

  New: `EventStoreExecutor.forget(id, user, db)` — a rebuild-safe hard-purge
  (Art. 17). It emits a 5th lifecycle verb `<entity>.forgotten` that hard-deletes
  the row even for `softDelete` entities; because the implicit projection replays
  it, the erasure survives a projection rebuild (a direct `deleteMany` did not).

  bundled-features: the user / fileRef / folder GDPR-forget hooks and the
  user-session store now write rebuild-safely (executor events / unmanaged table)
  — a projection rebuild no longer resurrects erased PII.

- d6fbd00: Personal Access Tokens: long-lived, revocable bearer credentials for headless HTTP-API access.

  - New `personal-access-tokens` bundled-feature: `read_api_tokens` direct-write store, SHA-256 token hashing, show-once mint, `create`/`revoke`/`mine`/`available-scopes` handlers, and a mountable `PatTokensScreen` web UI (`personalAccessTokensClient()`).
  - Framework auth seam: bearer tokens prefixed `kpat_` resolve via a new `patResolver` (before jwt.verify) into a `SessionUser`; roles are resolved live per request (not snapshotted). Config-driven scopes (app declares named QN-glob bundles) are enforced fail-closed at the API boundary. Optional per-token rate limiting.
  - `runProdApp`/`runDevApp` auto-wire the resolver + rate limiter when the feature is mounted. All new `AuthRoutesConfig`/`SessionUser` fields are optional — no change for apps that don't mount it.

## 0.105.2

### Patch Changes

- a305251: Add `userEmailBeforeDelete` to `UserDataHookCtx` so forget delete-hooks can match user-owned rows across every tenant pass before the user row is anonymized.

## 0.105.1

## 0.105.0

### Minor Changes

- 1918250: entityList: `rowActions` vom Typ `navigate` können mit `rowClick: true` als Ziel des Row-Body-Klicks markiert werden — ein Klick auf die Zeile (nicht nur das „…"-Aktionsmenü) löst dann diese Navigation aus.

  Vorher navigierte der Row-Body-Klick ausschließlich zu `entityEdit`-Screens (`create-app` `effectiveOnRowClick`). Deklarative Listen, deren Editor ein `custom`-Screen ist, hatten dadurch einen toten Row-Klick, obwohl sie eine `navigate`-`rowAction` deklarierten. Opt-in — bestehende Listen bleiben unverändert. Höchstens eine `rowClick`-Action pro Liste (Boot-Validator). Der navigate-Dispatch ist zwischen Aktionsmenü und Row-Klick geteilt, damit beide Pfade nicht auseinanderdriften.

## 0.104.0

### Minor Changes

- a3c973e: auth-email-password: migrate the tenant-invite flow off its app callback onto the `delivery` system, completing the #562 migration (all four magic-link flows now mail via `ctx.notify`).

  `invite-create` now dispatches the invite mail itself via `ctx.notify` (delivery), like reset/verify/signup — and no longer returns the token in its result, so a tenant admin can't see or accept with the invitee's token. `delivery` is now a hard boot requirement when invite is mounted.

  Breaking:

  - `InviteConfig` (framework auth-routes) drops `sendInviteEmail` / `appAcceptUrl` — only the three accept handlers remain.
  - `InviteOptions` / dev-server `InviteSetup` carry `appUrl` (+ optional `appName` / `locale`) instead of the callback.
  - `InviteCreateData` no longer includes `token`.
  - `renderInviteEmail` returns structured `AuthMailContent` (was `RenderedEmail`); `RenderInviteEmailArgs` switches `inviteUrl` → `url`.
  - `createAuthMailerConfig` / `AuthMailerConfig` / `CreateAuthMailerConfigArgs` are removed (invite was the last callback consumer); `RenderedEmail` is removed. `AuthPaths` / `DEFAULT_AUTH_PATHS` / `makeAuthPaths` keep their public names (moved to a dedicated module).

  Mount `delivery()` + a mail channel + a transport instead of wiring `sendInviteEmail`.

## 0.103.0

### Minor Changes

- 961d0bb: auth-email-password: migrate the magic-link mail flows (password-reset, email-verification, signup) off app-supplied `send*Email` callbacks onto the `delivery` system (#562).

  `ctx.notify` is now wired in production: `runProdApp` / `runDevApp` build a `DeliveryService` and bind it as the dispatcher's per-user `_notifyFactory` when the `delivery` feature is mounted (previously only tests wired it, so every production notification was silently dropped). The three flows' request handlers now render structured content and dispatch via `ctx.notify({ route: { email }, priority: "critical" })`; `delivery` becomes a hard boot-time requirement when any of them is mounted.

  Breaking for app authors who wired these flows by hand:

  - `PasswordResetConfig` / `EmailVerificationConfig` / `SignupConfig` (framework auth-routes) no longer take `sendResetEmail` / `appResetUrl` / `sendVerificationEmail` / `appVerifyUrl` / `sendActivationEmail` / `appActivationUrl` — they shrink to `{ requestHandler, confirmHandler }`.
  - `PasswordResetOptions` / `EmailVerificationOptions` / `SignupOptions` (and the dev-server `*Setup` wrappers) now carry `appUrl` (+ optional `appName` / `locale`) instead of the callback; `signup` now requires `appUrl`.
  - `createAuthMailerConfig` / `AuthMailerConfig` shrink to invite only.
  - `renderActivationEmail` now returns structured `AuthMailContent` (was `RenderedEmail`); `RenderActivationEmailArgs` is removed (use `RenderTokenContentArgs`).

  Mount `delivery()` + a mail channel + a transport instead of writing the reset/verify/signup mail callbacks. Tenant invite is unchanged (still callback-based).

## 0.102.2

## 0.102.1

## 0.102.0

### Minor Changes

- 020d5e8: delivery: decouple email rendering into chained jobs + map notify priority onto the job queue (#267)

  - **Framework:** job handlers now receive the `jobRunner` on their context, so a job can dispatch a follow-up job (job→job chaining). `jobRunner.dispatch` accepts `meta.priority` and forwards it as the BullMQ job priority.
  - **delivery:** queued-mode channels (email, push) now deliver asynchronously. Email runs through `delivery.render` → `delivery.send` so the expensive render step is isolated in its own worker and retries independently of the SMTP send; push (no render step) goes straight to `delivery.send`. inApp stays inline (DB insert + SSE). Without a `jobRunner` configured, queued channels fall back to synchronous inline delivery.
  - **delivery:** `notify()` `priority` (`critical`/`normal`/`low`) now maps onto the BullMQ job priority (1/2/3), so critical notifications jump ahead of low-priority ones in the worker queue.
  - **delivery:** `read_delivery_attempts` gains a `priority` column and a `queued` status; an async attempt transitions `queued` → `sent`/`failed` on one event stream.

## 0.101.0

## 0.100.0

### Minor Changes

- 17b44b3: Unify file-storage wiring through file-foundation (#608)

  Uploads, `ctx.files` and the GDPR export/forget jobs now resolve the
  `FileStorageProvider` per-tenant through a single source — file-foundation — so
  they always hit the same store by construction. This closes a correctness trap
  where an app could wire upload storage to one bucket while Art. 17/20
  erasure/export resolved another, making erasure report "done" while bytes
  survived and export return empty.

  - **BREAKING**: `buildServer({ files: { storageProvider } })` and the API
    entrypoint's `files` option are removed. Mount `file-foundation` + a
    `file-provider-*` feature (`inmemory`/`s3`/`s3-env`) and select one per tenant
    via the `file-foundation:config:provider` config key. Upload-route policy
    (`accessGuard`/`privilegedRoles`/`maxUploadSize`) moves to
    `createFilesFeature(opts?)`. The `/api/files` routes mount automatically when
    the registry declares file/image fields and a provider plugin is mounted.
  - **BREAKING**: `createFileContext(provider)` is now
    `createFileContext(resolve)` (a tenant-bound provider thunk), and
    `createFileRoutes` takes `resolveProvider` instead of `storageProvider`.
  - `createFileProviderForTenant` and the file-provider plugin types now live in
    `@cosmicdrift/kumiko-framework/files`;
    `@cosmicdrift/kumiko-bundled-features/file-foundation` re-exports them, so
    those imports are unchanged.

### Patch Changes

- aaf890e: Harden JWT verification: `verify()` now validates the payload claim shape — a
  well-formed RFC-4122 `tenantId` and a `roles` string array — after the signature check,
  and rejects malformed or hand-crafted tokens instead of casting the claims blindly. Tokens
  minted by `sign()` are unaffected; a token whose `tenantId`/`roles` claims are missing or
  of the wrong type is now rejected (verify throws → 401) instead of flowing into the
  pipeline with junk claims.

## 0.99.0

### Minor Changes

- 8146e5b: tags + renderer: inline tag chips on list rows, via a reusable component column

  - **renderer**: an `entityList` column can now be a _virtual labeled column_ — a presentational column drawn entirely by a `columnRenderer` component from the row, not tied to an entity field. Declare `{ field, label, renderer: { react: { __component } } }`; the new `label` also overrides any column's header (i18n key or literal). Any feature can now build component columns — tag chips, status badges, avatars — not just string formatters.
  - **tags**: new `TagsCell` column renderer (registered via `tagsClient().columnRenderers`) shows an entity's tags as colored chips inline in any list row. Drop `{ field: "tags", label: "Tags", renderer: { react: { __component: TAGS_COLUMN_RENDERER_NAME } } }` into any `entityList` — no host-schema change.
  - **tags**: `TagFilter` now shows the active selection as colored chips with a clear button, instead of just a count, so the active filter is visible.

## 0.98.0

## 0.97.1

### Patch Changes

- c5410a3: Fix: `buildAppSchema` dropped `derivedFields` from the client AppSchema, so a declarative `entityList` with a derived column threw `computeListViewModel: references unknown field` at render (the column resolved server-side + boot-validated, but the browser had no derived-field metadata). `projectEntity` now projects `derivedFields` metadata (`valueType`, with the server-only `derive` fn stripped — stays JSON-safe). Regression test pins the buildAppSchema→client path that no test covered before.

## 0.97.0

### Minor Changes

- 4e2bd72: Boot-validator: `entityList` rowAction/toolbarAction `navigate` targets may now resolve to a screen registered in ANY feature, not only the list screen's own feature. The runtime router already resolves a bare screen id app-wide across all features, so a declarative list that lives in the entity's owning feature can navigate to a consumer app's custom editor screens (e.g. a `credit`-feature list opening money-horse's `credit-calculator`/`bauspar-edit`). `redirect`/`cancelTarget` stay same-feature — their router builds the URL directly from the short id.

## 0.96.0

## 0.95.0

### Minor Changes

- 387f259: Timezones (#268, item 13): `GeoTzProvider` interface + injection seam.

  `ctx.tz` gains `fromCoordinates(coords)` and `fromAddress(address)` — both delegate to an optional `GeoTzProvider` injected via the app context (`buildServer({ context: { geoTzProvider } })` or `runProdApp`/`runDevApp({ extraContext: { geoTzProvider } })`). With no provider configured they throw a clear, actionable error (v1 ships no auto-lookup).

  `fromCoordinates` is the primary method — offline geo-tz libraries resolve lat/lng → zone (they don't take postal addresses); `fromAddress` is optional, for geocoding-API providers. New exports from `@cosmicdrift/kumiko-framework/time`: `GeoTzProvider`, `GeoCoordinates`, `GeoAddress`.

  Interface + seam only — a concrete provider (e.g. an offline geo-tz package) ships separately.

- da32b71: Timezones (#268, item 10): render `locatedTimestamp` fields as a proper located date-time picker.

  A `{ type: "locatedTimestamp" }` entity field now renders a wall-clock date + time input plus an IANA time-zone selector (new `LocatedTimestampInput`, `Input` kind `"locatedTimestamp"`) instead of falling through to a plain text input. The picker is pure wall-clock — no UTC conversion and no `new Date()` in the UI; it emits `{ at, tz }` and the server computes `utc`. New default i18n keys `kumiko.field.timezone` + `kumiko.field.locatedTzHint`.

  Apps that replace the default web primitives should add a `case "locatedTimestamp"` to their `Input` implementation; `DefaultInput` handles it out of the box.

## 0.94.0

### Minor Changes

- 31a2abf: feat(entity): read-time derived (computed) fields for entityList

  `EntityDefinition.derivedFields` declares named values computed per row from the
  stored columns + the clock at query time — never persisted, no DB column, never
  writable. A declarative `entityList` can name a derived field as a column like
  any other; the list-query handler appends the computed value to each row. This
  removes the need to fork a whole custom screen just because one column is
  live-computed.

  Author with `createDerivedField({ valueType, derive })`; `derive` takes its
  clock from `ctx.asOf` (no-date-api safe, unit-testable). Derived columns are
  display only — a declarative list sorts/searches server-side over real columns,
  so for a sortable/searchable derived value, materialize it as a stored field.

## 0.93.0

### Minor Changes

- 37d0ea4: Timezones (#268, item 9): boot/write validations.

  - `type:"tz"` and `locatedTimestamp` time-zone values are now validated against the IANA zone list at the write boundary — an invalid zone fails with a 4xx here instead of surfacing later in `ctx.tz.parse`/Temporal.
  - The server warns at boot when its process time zone is not UTC (the framework assumes a UTC server clock).

  New exports from `@cosmicdrift/kumiko-framework/time`: `isValidIanaTimeZone`, `warnIfNonUtcServerTimeZone`.

## 0.92.0

## 0.91.0

## 0.90.3

## 0.90.2

## 0.90.1

## 0.90.0

## 0.89.0

### Patch Changes

- ca33c52: HTTP-cache hardening + load reduction for the public-page caches (follow-up to the cache helpers in #630).

  - **`cachedResponse`: `If-None-Match` now decides alone.** Per RFC 7232 §3.3 a present `If-None-Match` makes `If-Modified-Since` irrelevant. Previously a mismatching ETag fell through to the `If-Modified-Since` branch and could still return a stale `304`. Benign in the current call sites (static ETags are mtime+size based, revision routes carry no `last-modified`), but now correct: ETag present → ETag alone.
  - **Multi-tenant `index.html` is served with `Vary: Host`.** `runProdApp`'s `hostDispatch` path picks the HTML file per Host and serves it `public`. Without `Vary: Host` a shared cache could key only on the URL; only the `max-age=0, must-revalidate` + per-Host ETag kept it from leaking one tenant's schema-injected shell to another. `Vary: Host` makes the isolation explicit instead of incidental, matching `managed-pages`.
  - **`legal-pages` / `managed-pages` cache for 60s.** Both served `public, max-age=0, must-revalidate`, so every request hit the origin to revalidate — and each `304` re-ran the content (and branding) query just to recompute the revision ETag. They now use `public, max-age=60, must-revalidate`: CDN/browser serve fresh for 60s without an origin round-trip, edits go live within 60s.

- dbc2c2d: projection-rebuild: recover late-committing lower-id events under the fence (#443). bigserial assigns event ids pre-commit (id-order ≠ commit-order), so a concurrent cross-aggregate write could commit a lower id after the unlocked catch-up advanced past it; the fenced final drain (`WHERE id > cursor`) then skipped it permanently, silently losing it from the projection. The fence makes the subscribed-event set final, so the rebuild now count-rechecks against it and — only on a detected shortfall — rebuilds the shadow from scratch and replays the full log, with no double-apply and no cost on the common path.

## 0.88.0

## 0.87.3

### Patch Changes

- 070c032: Add a read-time backstop against reserved tenant-membership roles. The write paths already reject `system`/`SystemAdmin`/`all`/`anonymous` from memberships at command time, but command-time validation does not survive an event-sourcing projection rebuild: replaying a stored `tenant-membership.created` event goes through the apply path, not the handler, so a membership role that was forbidden when written could be resurrected into the projection.

  `stripForbiddenMembershipRoles` (new, exported from `@cosmicdrift/kumiko-framework/engine`) filters reserved roles out of the membership portion at every JWT mint that derives roles from a membership — login, switch-tenant, invite-accept, and invite-signup-complete. `globalRoles` (where `SystemAdmin` legitimately lives) is never filtered, so real platform admins are unaffected. The forbidden-role set is now the single source of truth in the engine; `bundled-features` re-exports `findForbiddenMembershipRole` from it.

## 0.87.2

### Patch Changes

- b04ca86: Fix tenant privilege escalation via membership roles. `hasAccess` checks session roles flat with no notion of origin, so a platform-global role (`SystemAdmin`/`system`) landing in a tenant membership merged into the session and unlocked the SystemAdmin-gated, cross-tenant handler surface — a Tenant-Admin could invite `SystemAdmin` and the invitee gained platform-wide, cross-tenant access.

  Reject reserved/global roles (`system`, `SystemAdmin`, `all`, `anonymous`) at every tenant-membership write chokepoint: `seedTenantMembership` (covers the three invite-accept branches plus seeding), `add-member`, `update-member-roles`, and early in `invite-create`. The bootstrap path was already correct (SystemAdmin lives in global `users.roles`, never in a membership); this makes the invite path consistent.

  Also centralize the `tenantIdOverride` SystemAdmin gate into a new `crossTenantOverrideDenied` helper (exported from `@cosmicdrift/kumiko-framework/engine`), replacing the inline check duplicated across managed-pages, compliance-profiles, text-content and template-resolver so a future override handler can't skip it.

## 0.87.1

### Patch Changes

- cb2abcd: Session bootstrap only mounts behind SessionAuthGate so public SPA gates (e.g. `/rechner`) no longer call `/api/auth/tenants`. Skip refresh when no `kumiko_csrf` cookie is present.

## 0.87.0

### Minor Changes

- c0cbfb5: Add HTTP cache helpers (`cachedResponse`, ETag computation, `CachePolicy`) to `@cosmicdrift/kumiko-framework/api` and wire them into prod static-fallback plus `legal-pages` / `managed-pages` public HTML routes.

## 0.86.0

### Minor Changes

- 0a80617: boot(gdpr): V2 export-without-erase guard — warns at boot when a feature registers an EXT_USER_DATA export hook but no delete hook (Art.17 risk)

## 0.85.0

## 0.84.0

### Minor Changes

- 189f0cb: boot(gdpr): V2 export-without-erase guard — warns at boot when a feature registers an EXT_USER_DATA export hook but no delete hook (Art.17 risk)

## 0.83.0

### Minor Changes

- e36a2b0: GDPR forget (Art. 17): configurable tenant-occupancy model for tenant-scoped contributors.

  A tenant-scoped contributor with no per-user column (e.g. credit) can now erase a forgotten user's data when the app runs one user per tenant. The `user-data-rights` feature exposes a system-scoped `tenantModel` config (`"single-user" | "multi-user"`, default `"multi-user"`); the forget pipeline refines it **per tenant** with a runtime sole-member check and hands the effective model to each delete-hook via `ctx.tenantModel`. A stray invite that makes the `"single-user"` claim false at runtime downgrades to `"multi-user"`, so a co-member's data is never deleted on a per-user forget. Default `"multi-user"` preserves the existing safe no-op behaviour. New public type `TenantUserModel`.

### Patch Changes

- c2b7154: Diagnosability + i18n completeness for error paths.

  - The HTTP layer now logs unexpected server faults (5xx) at the boundary with the failing handler `type` and the original `cause` stack. Previously a wrapped throw (`InternalError{cause}`) returned a 500 with **zero log lines** — undiagnosable in prod. Expected 4xx outcomes stay unlogged (no noise).
  - Added the generic `errors.*` default translations (`errors.internal`, `errors.notFound`, `errors.access.denied`, `errors.conflict`, `errors.versionConflict`, `errors.uniqueViolation`, `errors.unprocessable`, `errors.unconfigured`, `errors.feature.disabled`, `errors.rate_limited`) plus `errors.download.urlMissing` to the framework default bundle, so no consumer ever renders a raw i18n key as the user-facing message.

## 0.82.0

## 0.81.1

## 0.81.0

## 0.80.0

## 0.79.3

### Patch Changes

- cd34ef3: fix(user-data-rights): logged-in export download no longer returns 403 csrf_token_mismatch

  The privacy-center download was a plain `<a href>` to the `by-job` httpRoute, which
  re-dispatched an internal `POST /api/query` carrying only the auth cookie (no
  `X-CSRF-Token` header) — so the CSRF double-submit check rejected it with 403. The
  download now goes through the dispatcher via a new `postWithDownload` helper
  (`@cosmicdrift/kumiko-renderer-web`), which carries the CSRF token like every other
  authenticated request and navigates to the returned signed URL. The `by-job`
  httpRoute and its header-forwarding are removed; `download-by-job` reads the audit
  IP from the server-trusted request context instead of a client-supplied payload.

## 0.79.2

### Patch Changes

- 335ffef: Phase 3 Iter 2 (Plan-Doc D8): `scripts/record-demo.ts` orchestrates the
  full macOS recording stack — tmux 2-pane layout, Playwright headed
  chromium positioned via osascript, `ffmpeg -f avfoundation` screen
  capture, walk DemoDef steps with typing delays for CLI / page actions for
  browser / `cat`-into-file for editor, then a palette-tuned `mp4 → gif`
  plus first-frame poster. Captions JSON is generated from the captured
  step durations so the marketing-site overlay never drifts from the
  recording.

  Output: `dist/hero-recording/{demo.gif, demo-poster.png, captions.json}`
  — copy into `kumiko-platform/apps/marketing/public/hero/` to lift the
  draft on PR #250. `scripts/demos/RECORDING.md` carries the brew installs,
  Screen-Recording permission prompt, and the cp → push → `gh pr ready`
  recipe.

  Pure-logic tests (`parseArgs`, `resolveDemoByPrefix`) ship as
  `scripts/__tests__/record-demo.test.ts`; the tmux / ffmpeg / Playwright
  orchestration is exercised by an actual recording session rather than
  mocked.

## 0.79.1

## 0.79.0

## 0.78.0

## 0.77.1

### Patch Changes

- b91862b: Phase 3 (Plan-Doc `create-kumiko-app.md`) Iter 1: scaffolds the demo
  recording pipeline as a schema-first format. `scripts/demos/` carries the
  step DSL (`step.cli` / `step.browser` / `step.editor`), the wrapper
  (`demo({title, steps})`), the hero demo (`01-create-app.ts`, the
  10-step `curl … | bash` → login → add-feature flow), and a unit-level
  dry-run validator that pins selector shape + caption length per step.

  The actual recorder (`scripts/record-demo.ts`: tmux 2-pane + Playwright
  headed + ffmpeg → GIF) and the marketing-site hero (`HeroDemo.astro` +
  `captions.json` in kumiko-platform) arrive in Iter 2 alongside the
  recording session that produces the first real GIF asset. This package
  ships only the schema-side so a follow-up PR can swap in the recorder
  without churning the step definitions.

## 0.77.0

## 0.76.1

### Patch Changes

- 491f034: `KumikoBootError.message` now includes the per-var detail block (var name,
  source feature, missing/invalid reason, suggestion) instead of just the
  single-line header. Previously an uncaught throw — e.g. `bun run boot` on a
  freshly-scaffolded app with an unset `JWT_SECRET` — printed only

  ```
  KumikoBootError: Boot failed: 1 env-var problem
   errors: [ [Object ...] ],
  ```

  with the actual culprit collapsed inside Bun's default object pretty-print.
  Now the message itself carries the same body that `.format()` already
  produced, so the user sees which var caused the failure without needing to
  add a `catch`-block + manual `.format()` call.

## 0.76.0

### Minor Changes

- 5828e0c: Deterministic event-stream placement for tenant-independent aggregates (#497).

  New `createEntity({ systemStream: true })` option: an aggregate flagged this way
  puts its event stream on `SYSTEM_TENANT_ID` for every operation, instead of
  scattering across whichever tenant happened to create it. Routing is per-entity
  (opt-in), not inherited from `r.systemScope()`. The `user` entity now sets it —
  a user belongs to N tenants, so its stream must not be keyed by an arbitrary
  "signup-time" tenant. This removes the need for the `getAggregateStreamTenant`
  recovery workaround on new data (the workaround stays for un-migrated streams).

  MIGRATION REQUIRED for existing deployments: user-aggregate event streams created
  before this version live on a scattered tenant. After upgrading, run once per DB:

  UPDATE kumiko_events
  SET tenant_id = '00000000-0000-4000-8000-000000000000'
  WHERE aggregate_type = 'user'
  AND tenant_id <> '00000000-0000-4000-8000-000000000000';

  (The `read_users` projection has no `tenant_id` column, so no rebuild is needed.)
  Without the migration, writes to existing users version-conflict because the new
  code addresses their stream on SYSTEM_TENANT_ID. Deploy the migration with the
  release (maintenance window), not after.

## 0.75.0

## 0.74.0

## 0.73.0

## 0.72.0

### Minor Changes

- a6d3b3b: Add `r.uiHints({...})` for picker/scaffolder metadata

  Features can now declare optional UI metadata via `r.uiHints({ displayLabel, category, recommended, configurableOptions })`. The hints flow through `defineFeature` into `FeatureDefinition.uiHints` and into `feature-manifest.json` under `feature.uiHints`. Pure manifest-side info — the framework runtime does not read it. Consumers (the upcoming `bun create kumiko-app` picker, the docs feature-reference) treat absent hints as "no special treatment" and fall back to `name` + `description`. Eight picker-MVP bundled features carry hints out of the box (`auth-email-password`, `tenant`, `user`, `sessions`, `delivery`, `files`, `billing-foundation`, `feature-toggles`); the remaining bundled features remain unannotated and will be filled in alongside the picker work. Additive — no breaking changes.

## 0.71.0

### Minor Changes

- 0be304e: Block locked accounts at the session layer (defense-in-depth)

  The session checker now reads the user's lifecycle status on every authenticated request and refuses a live session whose user is `restricted` or `deleted`, returning the new `"blocked"` `AuthSessionStatus` (401). This is a second layer on top of session revocation: a missed revoke can no longer keep a locked account authenticated. `active` and `deletionRequested` users are unaffected (the latter keeps its session so it can still cancel a pending deletion). The check fails open on a user-row miss so a lookup issue degrades to "revocation still protects" rather than a global lockout. The `sessions` feature now declares `r.requires("user")`.

- 7b8d405: Complete soft-delete: auto cleanup cron, configurable grace period, and trash queries.

  When any entity opts into `softDelete`, the framework now auto-wires:

  - a `soft-delete:job:cleanup` cron (perTenant, nightly at 03:00) that hard-deletes rows soft-deleted longer than the grace period — bounding unbounded growth of soft-deleted rows;
  - a `soft-delete:config:grace-days` tenant config key (number, default 30) controlling that window.

  Query handlers can now request soft-deleted rows via `ctx.includeDeleted` (the entity-list query accepts an `includeDeleted` flag). Tenant and ownership filters still apply, so a trash query never widens what a user may see beyond the live list. The event stream is untouched — cleanup only purges the read-model rows.

## 0.70.0

### Minor Changes

- 487734f: Add the R6 compile-time secret-response guard. `defineWriteHandler` and `defineQueryHandler` now reject a `Secret<>`-branded value anywhere in a handler's inferred response type at compile time — the static twin of the existing `assertNoSecretLeak` runtime guard. Clean responses, including branded primitives (e.g. `TenantId`) and opaque leaves (`Temporal.*`, `Date`), are unaffected, and handlers generic over their response still compile (the guard is biased to defer to the runtime guard when it cannot prove a leak). Exposes the `ContainsSecret<T>` predicate from the secrets module.

## 0.69.0

## 0.68.0

## 0.67.1

## 0.67.0

### Minor Changes

- d732bde: tier-engine: derive the trial from `tenant.inserted_at` and enforce it as a live gate

  Real auth-signups create the tenant via `seedTenant` (event-store executor), which
  bypasses the dispatcher `postSave` hook — so the auto-default `tier-assignment` row was
  never written and the cached trial-clock never warmed. A freshly signed-up tenant got
  neither a tier-assignment nor the 30-day trial on the server side.

  The trial is now derived from `tenant.inserted_at` (which always exists for every tenant)
  and checked live at the dispatcher feature-gate via a new optional `trialGate` on
  `EffectiveFeaturesResolver`, consulted only on the already-disabled cold path. The sync
  boot-cached resolver hot path is unchanged; `checkFeatureEnabled`/`ensureFeatureEnabled`
  become async (both call sites were already async). Removes the cached `trialClock` and the
  resolver trial-union. New exported type: `TrialGate`.

## 0.66.0

### Minor Changes

- 77ed9c1: Let the config-generated entity-edit form express the common shadcn form
  shapes (title + subtitle, flat single-section layout, domain-specific submit
  CTA). Driven by rebuilding real shadcn reference designs purely from the schema
  to find what the auto-UI couldn't yet do:

  - **Optional section title**: `EditFieldsSection.title` is now optional. A
    title-less section renders just its fields (no `h3`), so a form can be a flat
    "card title + fields directly" layout instead of being forced into a labelled
    sub-section. The whole-form card title/subtitle carries the context.
  - **entityEdit submit label**: `EntityEditScreenDefinition.submitLabel` (i18n key
    or raw string) overrides the generic "Save" — e.g. "Save Address", "Create
    item". Wired through `KumikoScreen` (create + update branches) into the
    existing `RenderEdit` `submitLabel` prop.
  - **Form subtitle**: `FormProps.subtitle` renders a muted line under the form
    title. `RenderEdit` resolves title + subtitle create/edit-aware via
    `screen:<id>.<create|edit>.title` / `.subtitle` (falling back to
    `screen:<id>.title`/`.subtitle`, then the screen id), so a create screen reads
    "Create item / Add a new item to your catalog" and the edit screen differs.

  No breaking changes — existing titled sections and the default save label are
  unaffected. A new `styleguide` "Examples" feature rebuilds the shadcn Shipping
  Address design from a schema as the first config stress-test.

- 15b06c1: Add interactive faceted filters to the auto-generated entity list — the shadcn
  data-table pattern (outline dropdown buttons with multi-select checkboxes, like
  the "Columns" toggle). Each `filterable: true` **select** or **boolean** field
  becomes a facet dropdown in the list toolbar; selecting values filters the list
  server-side and a "Reset" clears all active facets.

  Wiring across the layers:

  - **Query schema** (`defineEntityListHandler`): a new `filters?: Filter[]`
    field next to the existing static `filter?` — additive, no contract break.
    `executor.list` applies the static filter and every dynamic filter with AND
    (the `op:"in"` array path already produced correct `IN (...)` SQL).
  - **Client schema** (`buildAppSchema`): the field-level `filterable` flag is now
    serialized so the renderer knows which fields can be faceted.
  - **URL state** (`useListUrlState`): facet selections live under
    `?<screenId>.f.<field>=v1,v2` keys, page-resetting on change, with
    `setFilter` / `clearFilters`.
  - **Renderer**: `KumikoScreen` derives the facets from the entity's filterable
    select/boolean fields (labels via the existing `field` / `:option:` i18n
    convention) and builds `payload.filters` (booleans coerced from the URL
    strings). New `DataTableFacet` type + `filterFacets` / `filterValues` /
    `onFilterChange` / `onFilterReset` props on `DataTableProps`.
  - **renderer-web**: `DefaultDataTable` renders each facet as a vendored shadcn
    `DropdownMenu` of `DropdownMenuCheckboxItem`s with an active-count badge — no
    new registry primitive.

  Range filters (number/date `lt`/`gt`) are intentionally out of scope; only
  equality facets (select/boolean) are rendered.

## 0.65.0

### Minor Changes

- 1586c8c: `runSchemaCli` gains an optional `{ features }` option: when given, `schema apply` rebuilds the projections whose tables a freshly applied migration changed (via its `.rebuild.json` marker) — the projection-rebuild step app `bin/kumiko.ts` files duplicate today. Backward compatible: the dev `kumiko schema` path omits `features` and applies migrations only.

### Patch Changes

- 6ac4ff6: Config-schema / boot hardening (review findings):

  - **role-leak (#406/2):** `scopedKeysAt` now strips `MACHINE_WRITE_ROLE` ("system") from the roles it returns, so a config key with a mixed write-set (e.g. `["system", "SystemAdmin"]`) yields a `{ roles: ["SystemAdmin"] }` screen gate instead of leaking the machine role into the human access union.
  - **silent-skip (#408/3):** an app workspace that references an audience nav-QN which is never generated (e.g. `config:nav:audience-user` with no user-scope config keys registered) now emits a dev-only authoring warning instead of rendering invisibly with no hint.
  - **env-guard (#408/1):** the Settings-Hub authoring warnings are now also suppressed under `NODE_ENV=test` (not only production), so `bun:test` runs no longer spew `console.warn` noise into CI logs.

- 773b368: Make user-lifecycle mutations rebuild-safe (data-loss, GDPR, #494):

  The `user` feature event-sources only entity creation (`user.created`). Every
  lifecycle mutation in `user-data-rights` — restrict, lift-restriction, the
  deletion grace period, cancel-deletion, the email-deletion request id, and the
  final forget `Deleted` flip — was a raw `updateMany` with NO event. Because the
  framework auto-registers every `r.entity` as a rebuildable implicit projection,
  any `read_users` rebuild replayed ONLY `user.created` and reset those columns to
  their defaults: `status` back to `active`, `gracePeriodEnd` /
  `pendingDeletionRequestId` to null, an Art.18 restriction or an Art.17 erasure
  silently undone. Latent production data loss on a GDPR path.

  Fix: the six lifecycle handlers now route through the event-store executor's
  `update()` (emitting `user.updated`, which the existing implicit reducer already
  replays). The `user` entity runs `r.systemScope()` but its events live on a
  concrete tenant stream, and the active tenant at lifecycle time can differ from
  the signup tenant — so the write is rescoped to the user's own stream tenant
  (the framework-injected `read_users.tenant_id`) for both the db read and the
  event, keeping `user.created` and `user.updated` on one `(tenant_id,
aggregate_id)` stream. The forget-cleanup flip stays inside its per-user
  savepoint sub-transaction (the connection is threaded through), so atomicity is
  preserved. A discriminating integration test (create on tenant A, lifecycle on
  active tenant B, then a real projection rebuild) asserts the lifecycle state
  survives — RED before the fix, GREEN after.

  Existing data: the forward fix only event-sources mutations made FROM this
  version on. Rows whose lifecycle state was written by the old raw path have no
  `user.updated` event, so a rebuild would still reset them. A one-time reconcile
  `backfillUserLifecycleEvents(conn)` (exported from `user-data-rights`) emits a
  `user.updated` capturing the current live state for every divergent
  `read_users` row. Apps that disabled `read_users` rebuilds as the interim
  mitigation MUST run this backfill once, THEN re-enable rebuilds — not before.

  No schema change.

## 0.64.0

### Minor Changes

- dbd1606: Add `kumiko-schema validate` — a static, DB-free CI gate that catches "this won't boot" before deploy. Two layers: (1) **schema drift** — fails if entity definitions are ahead of `kumiko/migrations` (an entity was added/changed but never `generate`d, so its table is missing in prod → runtime 500); (2) **boot validity** — runs `validateBoot` over the composed feature set when `kumiko/schema.ts` exports `FEATURES` (QN / screen / nav / role refs). Exit 0 clean, exit 1 with a report. The DB-level gate (`assertKumikoSchemaCurrent`) still runs at boot/deploy; this is the pre-deploy static counterpart any consumer app can run in CI.

## 0.63.0

## 0.62.0

## 0.61.0

## 0.60.4

### Patch Changes

- 7f55219: Close the deletion-token replay-after-cancel window (security, #354/1):

  The anonymous email-deletion flow mints a stateless HMAC token (60-min TTL).
  Previously a token stayed usable for its whole TTL even after the user cancelled
  the deletion — a still-valid token (intercepted mail, stale browser tab) could
  re-arm a second grace period.

  Fix: a per-request `pendingDeletionRequestId` is now stored on the user row when
  the request is minted (`request-deletion-by-email`) and nulled on
  `cancel-deletion`. The same id is folded into the token's HMAC purpose
  (`deletion-request:<id>`), so `confirm-deletion-by-token` recomputes the
  signature against the row's CURRENT id: a token from a cancelled cycle (id
  nulled) or a superseded one (newer id on the row) fails verification. The shared
  `signToken`/`verifyToken` primitive is untouched — the binding rides the
  existing purpose channel.

  Schema: additive nullable column `read_users.pending_deletion_request_id` (text).
  Consumer apps pick it up via a standard `ALTER TABLE … ADD COLUMN` on the next
  `kumiko schema generate`; existing rows default to NULL ("no pending request").

## 0.60.3

### Patch Changes

- af1b957: Strengthen the date-picker e2e year-navigation assertion (#411/1): the test
  now pins that the calendar grid actually navigated to the selected year by
  asserting a day-button carries that year in its accessible name, instead of
  only checking the `<select>`'s DOM value. An uncontrolled select would keep the
  old assertion green even if its `onChange` never fired and the grid stayed put;
  the added check fails in exactly that case.

## 0.60.2

### Patch Changes

- 68c5fee: Test-hygiene cluster (review findings):

  - **silent-pass (#377/1):** `renderer-web-css-relocation` integration test uses `test.skipIf(!bunAvailable())` instead of `if (!bunAvailable()) return;`, so a missing `bun` is reported as a visible skip rather than a green pass that hides lost coverage.
  - **fragile async flush (#315/2):** `custom-fields-form-section` test waits via `waitFor(...)` instead of two hardcoded `await Promise.resolve()` ticks — robust against an extra microtask in the async save loop.
  - **unsafe-cast (#380/1):** documents why the `undefined as never` redis/entityCache stubs are safe in the seed-migration runner test (that path uses neither dependency).

## 0.60.1

### Patch Changes

- bde2443: Fix three Med review findings:

  - **screen-filter (#343/1):** `decimal` fields are now comparable — `getAllowedFilterOps` returns the full `eq/ne/lt/gt/in` set instead of the empty default, so a `filterable: true` decimal field is no longer rejected by the boot-validator ("Allowed ops: (none)").
  - **auth-cookies (#321/1):** `setAuthCookies` now invalidates the host-only cookie variant when `cookieDomain` is set (symmetric to `clearAuthCookies`), preventing a stale host-only auth/csrf cookie from coexisting with the domain-scoped cookie after a deploy that introduces `cookieDomain`.
  - **test hygiene (#315/1):** `data-table-logic` test restores `NODE_ENV` by `delete`-ing it when it was previously unset, instead of writing the string `"undefined"` into the env (global-state leak into later tests).

## 0.60.0

### Patch Changes

- 95a4a6c: Fix `managed-pages:write:set` with `tenantIdOverride` so the SystemAdmin
  cross-tenant write is actually idempotent. The handler's `ctx.db` is tenant-
  scoped to the _executing_ user (createTenantDb "tenant" mode), which was wrong on
  both halves of the upsert for an override target: the existing-check
  (`fetchOne`) was blind to the target tenant's projection row, so a re-provision
  retried as a create and failed with `unique_violation`; and the event-store
  executor's stream reads (`getStreamVersion`/`loadAggregate`) ran against the
  executor's tenant, so even reaching the update path failed with
  `not_found`/`version_conflict`. The fix re-scopes a `TenantDb` to the resolved
  target tenant for the existing-check and the executor when an override is set
  (SystemAdmin-gated). Covered by three new integration tests (#382/2): override
  lands the row under the target tenant, a non-SystemAdmin override is denied, and
  an override on an existing page updates it without conflict.
- 16e1457: Three config-feature test-coverage gaps from review, all behaviour-discriminating
  (no fake/existence tests):

  - inherited-redaction: the inheritance control test only seeded a `default`, so
    it proved default-fallback visibility — not that a SET system-row value is
    inherited by tenants (the actual non-redacted invariant). Added a control key
    whose seeded system-row value (42) differs from its default (5), asserting the
    tenant receives 42 (#376/2).
  - app-override-visibility: the leak-guard test only asserted the value/source
    were `not` the leaked override, which stays green if the key drops out for
    another reason (e.g. access-deny). Added a positive `source === "missing"`
    anchor (#383/1).
  - backing-secrets: the PR's central "throws loud, never silently degrades"
    promise for `backing="secrets"` keys had no test. Added one that wires the
    feature WITHOUT `ctx.secrets` and asserts `config:write:set` fails with
    `internal_error`/500 and writes no config_values fallback row (#387/2).

- 22c1ba2: Cover the untested `enqueueProjectionRebuild` branch where a `jobRunner` is
  present but the `projection-rebuild` job is not registered (a caller that wired a
  jobRunner but forgot to compose `createJobsFeature()`) (#391/2). The
  `registry.getJob` capability guard must fall to the inline rebuild rather than
  dispatch onto a runner whose queue has no handler for the job — a silent no-op
  otherwise. The new test asserts `mode: "inline"`, that the projection is actually
  rebuilt, and that `dispatch` is never called.
- 34cb6e7: Add the missing `runDevApp` origin-guard forwarding test (#399/1). `runDevApp`
  forwards `allowedOrigins`/`unsafeSkipOriginCheck` to the server exactly like
  `runProdApp`, but only the prod path had a test — a typo or wrong spread-key on
  the dev path would silently drop the fail-closed CSRF guard and let dev/prod
  diverge. The new `run-dev-app.integration.test.ts` mirrors the prod pair:
  `cookieDomain` alone rejects with `allowedOrigins is empty`, and
  `cookieDomain + allowedOrigins` boots cleanly past the guard. It is an
  integration test because the guard fires during server build, after the
  ephemeral test DB is up.
- 141d29b: Two missing-test coverage gaps from review (test-only):

  - subscription-stripe `parseStoredSecret`: the error path was untested — the test
    stub always JSON-encoded its values, so a malformed (raw, non-JSON) stored
    credential never exercised `parseJsonOrThrow`. Added a raw-secret stub and a
    test asserting `clientForCtx` throws `Invalid JSON in subscription-stripe
credential` rather than silently degrading (#393/2).
  - encrypted-tenant-config recipe: the recipe's headline claim — that a `mask`
    entry alone makes `buildConfigFeatureSchema` derive the configEdit screen (no
    hand-written `r.screen`/`r.nav`) — was unverified. Added a test asserting the
    `billing-tenant` screen carries `configKeys["stripe-api-key"]` (qualified) and
    the `mask.title` field label (#392/1).

## 0.59.2

### Patch Changes

- c6018f4: `kumiko check`: the Action-Wiring guard step now runs with `--strict`. Without
  the flag the guard's `process.exit(1)` stays behind `if (strict)`, so violations
  were only printed to stderr and the step exited 0 — an invoked but never-failing
  no-op that could not gate the pipeline. Every other guard step already fails by
  exit code; this was the sole outlier. Verified safe: the guard currently scans
  154 files across the consuming repos with zero violations, so enabling the gate
  does not retroactively break the build.
- d57b42f: Two `kumiko check` pipeline fixes from review:

  - The `kumiko-guard-thin-wrappers` guard was published as a bin but wired into
    no pipeline step, so it never ran (silent coverage gap). It now runs as a
    warning-only step (exit 0, non-gating) in the check pipeline, matching the
    behaviour the docs describe. It cannot join the shared AST-guard runner — it
    builds its own ts-morph project and exports no `AstGuard`.
  - `check-app-tsc` printed a misleading "0 error(s) across 0 workspace(s)" and
    exited 1 when `tsc -b` failed without producing a line matching
    `error TSxxxx:` (a spawn failure, a config-load error, or a `TS6053`-style
    message) — CI red with no visible cause. It now surfaces the raw tsc output,
    spawn error and exit status instead (`describeUnparseableTscFailure`).

- fe4dd50: `custom-fields`: setting `valueWriteRoles` without `fieldDefinitionListRoles` no
  longer breaks asymmetrically. The save path ran with the app roles but the
  `field-definition:list` load path stayed on the default `["TenantAdmin"]`, so
  app-role users got `access_denied` and the CustomFieldsFormSection never loaded.
  When `valueWriteRoles` is set and `fieldDefinitionListRoles` is not, the value
  roles now inherit into the list default (unioned with the default so admins keep
  list access). Explicit `fieldDefinitionListRoles` still wins.
- 29aae4d: `user-data-rights`: the anonymous `confirm-deletion-by-token` endpoint no longer
  leaks the caller's account status. On a non-active user it previously returned
  `startDeletionGracePeriod`'s error verbatim, whose `details.currentStatus`
  exposed the live user status to anyone holding a valid token. It now returns a
  generic `cannot_process_deletion` reason at the public boundary; the
  authenticated `request-deletion` path still shows the user their own status.

  Also corrects the (now load-bearing) comments on the deletion token: the
  grace-period replay is idempotent only while no `cancel-deletion` intervenes —
  after a cancel a still-valid token can re-arm a second grace period, bounded by
  the token TTL. The full fix (per-request `requestId` bound into the token and
  the user row) is tracked separately as it requires a shared user-entity
  migration.

- 6c7262f: `user-profile` ProfileScreen fixes from review:

  - The deletion-grace banner injected `gracePeriodEnd` as a raw ISO instant, so
    users saw "…deleted on 2026-07-11T00:00:00.000Z". It now shows the date part
    only (`formatDeletionDate`, a pure string slice — no Date API, universal for
    RN+Web).
  - After an email change the screen fired `requestEmailVerification` with the
    result swallowed (`.catch(() => undefined)`) while unconditionally showing
    "we sent a verification link". A failed send is no longer silent (logged via
    `console.warn`) and the success message no longer promises delivery
    ("Please confirm your new address." / "Bitte bestätige deine neue Adresse.").
    The change itself stays successful regardless, since it is already persisted.

- a6c5bf5: Harden the `files-provider-s3` test coverage flagged in review. The
  `virtualHostedStyle` value `createS3Provider` passes to `Bun.S3Client` is the
  inverse of the (already tested) `resolveForcePathStyle` — the lone untested
  `!` seam that silently picks the wrong URL style for Minio/R2 if it drifts. It
  is now extracted as the exported `resolveVirtualHostedStyle` and covered by a
  truth-table test asserting it stays the strict inverse. A second test proves
  `getSignedUrl` actually signs `contentDisposition` into the presigned URL as the
  `response-content-disposition` query param (presign is a local HMAC op, so this
  is hermetic) — otherwise downloads would silently serve the UUID key instead of
  the file name. Test-only plus the small extraction.
- f7e9666: Harden the subscription-stripe billing-live (`#104`) test coverage. The
  invariant "no live checkout while `billing-live` is not true" was only ever
  exercised with a stubbed `ctx.config` — no test drove the real
  factory → `r.config` → `ctx.config(handle)` chain. A reviewer also flagged the
  `runtime.test.ts` fixture for hand-redeclaring the config handles (which could
  silently drift from production) and for a key-agnostic `config` mock that hid a
  wrong handle name.

  - Integration scenario 6 mounts subscription-stripe **without** the api-key
    fallback and proves the gate end-to-end: `billing-live` unset → checkout
    fails `feature_disabled`; setting `billing-live=true` on the canonical config
    QN flips the gate (the failure moves to `unconfigured` at api-key resolution).
    The positive case is what actually proves handle-resolution — a wrong handle
    name would keep `ctx.config` `undefined` and the error would stay
    `feature_disabled`.
  - `runtime.test.ts` now derives the config handle names from the canonical
    constants via the same `qn`/`toKebab` qualifier `r.config` applies, so the
    fixture cannot drift, and its `config` mock answers only for the billing-live
    handle so a misread key is caught.

  Test-only plus a corrected doc comment (the billing-live key qualifies to
  `subscription-stripe:config:billing-live`, not `…:billingLive`).

## 0.59.1

### Patch Changes

- 99b8220: Fix the boot-validator action-field allowlist so it accepts every row-meta column,
  not just `id`/`version`. `buildBaseColumns` materializes `tenantId`, `insertedAt`,
  `modifiedAt`, `insertedById`, `modifiedById` (plus `isDeleted`/`deletedAt`/`deletedById`
  on softDelete entities) on every entity row, yet `validateActionFieldRefs` only
  exempted `id`/`version` for `pick`/`map` sources and exempted nothing on `visible.field`.
  A legitimate `pick: ["id", "version", "tenantId"]` or `visible: { field: "id" }` therefore
  crashed the boot — the same CrashLoop class the validator is meant to fix, one meta-field
  over. The allowlist is now derived from `buildBaseColumns` via the new
  `rowMetaFieldNames(softDelete)` and applied to both the extractor-source and
  `visible.field` checks; softDelete-only columns stay unknown for non-softDelete entities,
  so picking on them there is still rejected.
- 31d2d99: The generated config settings-workspace switcher gate computed its access union
  from the raw masked-key list, which includes machine-only keys (write `["system"]`).
  That leaked the `"system"` role into the workspace `access` (e.g. `["system",
"SystemAdmin"]` instead of `["SystemAdmin"]`) whenever a machine-only key sat in the
  hub next to a human-writable one. No human carries `"system"`, so there was no access
  effect, but it contradicted the build-time exclusion the rest of the schema applies.
  The workspace access is now the union of the already machine-filtered hub navs, so
  `"system"` can no longer appear.
- 103c5f5: `resolveUnsafeClient` (db/schema-inspection.ts) returned `client.unsafe` without
  checking it resolved, so a db handle that exposes the raw postgres escape hatch on
  none of `$client` / `session.client` / itself crashed `tableExists` / `columnNamesOf`
  with an opaque `TypeError: unsafe is not a function`. It now throws a named, actionable
  error naming the three lookup paths it checked.
- 8a55f62: Search-index collision warnings now dedup per registry instead of in a
  process-global Set. The previous module-global `warnedKeyCollisions` Set in
  `buildSearchDocument` silenced the "searchPayloadExtension tried to overwrite …"
  warning for every later app instance once any instance had hit a given
  `entity:key` collision, and leaked dedup state across tests in the same
  process. It is now scoped to the registry via a `WeakMap<Registry, Set>`, so
  each app (and each test) dedups independently; the per-save dedup behaviour is
  unchanged. The warning text also reads "base field" instead of the stray German
  "Stammfield".

## 0.59.0

## 0.58.0

### Minor Changes

- f9897cd: Update-Awareness (default an): Der Prod-Build (`buildProdBundle`) schreibt eine
  selbsttragende Build-ID — ein Hash über die content-gehashten Asset-URLs — als
  `dist/build-info.json` und bäckt sie als `window.__KUMIKO_BUILD__` in die
  index.html. Jede renderer-web-App mountet einen `<UpdateChecker/>`, der beim
  Tab-Fokus (`visibilitychange`/`focus`) `build-info.json` pollt und ein
  Reload-Banner zeigt, sobald sich die ID ändert — ein offener Tab erfährt so von
  einem neuen Deploy, ohne Hard-Reload und ohne Service-Worker.

  `builtAt` (ISO-Zeitstempel) steht auf `window.__KUMIKO_BUILD__` als lesbare
  Anzeige-Version bereit (ersetzt rohe git-shas). Quelle ist die statische
  build-info.json, nicht `/api/version` (live unzuverlässig). Fail-safe: ohne
  gebackene Build-ID (Dev, altes Bundle) oder bei Fetch-Fehler kein Banner.

### Patch Changes

- 9733ddc: CLI command registry: add `createCommandRegistry()` and back the free
  `defineCommand`/`getCommand`/`getCommands` with a single process-wide default
  instance. The registry unit test now exercises a fresh isolated instance
  instead of clearing the shared default in `afterEach` (`_resetRegistry`, now
  removed) — that clear raced the bin/-command coverage tests that read the
  shared registry under the concurrent test runner, intermittently failing CI
  with "command \"status\" missing" on unrelated PRs.
- b02c52e: Review-fix mechanical batch: register `auth.errors.originNotAllowed` i18n key (de+en) used by origin-middleware; share the config read-redaction `MASKED` constant across the cascade/values query handlers; align Dockerfile `BUN_VERSION` to CI (1.3.14); use `SYSTEM_TENANT_ID` and an `isErrorBody` type-guard instead of hardcoded UUID / unchecked casts in tests.
- 0202d38: Pending-rebuilds: scope the queue clear to the (table_name, migration_id) snapshot the run read, so a concurrent re-queue of the same table for a newer migration is no longer dropped between the read and the clear (#328). event-store list: document that list rows carry the read-row version (display-only, never an optimistic-lock base — edits reload via detail) so the #336 version_conflict can't creep back in.
- a3dcb2c: Projection rebuild: mark the cutover seam as `__test_onBeforeFence` so a production caller can't accidentally hold the ACCESS-EXCLUSIVE fence open (#404/5). Document a known limitation (#443) — a cross-aggregate write that commits with an event id below the rebuild cursor after the cursor passed it is dropped (bigserial assigns ids pre-commit); add a deterministic characterization test pinning the data-loss until a watermark-based fix lands.

## 0.57.2

### Patch Changes

- 99d4489: Correctness fixes from PR review:

  - `securePageHeaders` now spreads hardened security headers LAST so a caller's `extra` can never override CSP/nosniff/frame-options.
  - `assertOriginGuardConfig` throws on the contradictory `unsafeSkipOriginCheck: true` + non-empty `allowedOrigins` combo instead of silently keeping the guard.
  - Decimal write-schema scale check is now float-robust (`isRepresentableAtScale`): a computed-but-in-scale value like `0.1 + 0.2` is accepted at scale 2 instead of being falsely rejected.
  - `createDecimalField` validates `precision`/`scale` at definition time (integer, `precision ≥ 1`, `0 ≤ scale ≤ precision`) instead of failing at migration time.
  - ENV config bridge skips whitespace-only values and trims `select`/`text` values before option matching.
  - `fenceLiveTable` rejects `lockTimeoutMs <= 0` (Postgres treats `lock_timeout = 0` as wait-forever, the opposite of fail-fast).
  - Deletion verify-URL is built via `URL`/`searchParams` so a base URL with existing query params no longer produces an invalid `?a=b?token=`.

## 0.57.1

### Patch Changes

- d07ef3f: Smart entity mapping for bare CRUD write handlers (`create`/`update`/`delete`):
  maps to the matching entity when the feature name matches or the feature owns
  exactly one entity. Boot and registry validate extension `preSave` wiring so
  handlers like `credit:write:create` wire `credit-cap` without `entity:verb`
  handler names or 4-segment QNs.

## 0.57.0

### Minor Changes

- 2e78232: config: `access.withSystem(roles)` — system-provisionable tenant self-service keys (#396)

  Tenant-scope self-service config (e.g. the managed-pages branding keys) had no
  system-write path: a key whose write-role was `access.admin` rejected the system
  executor (`ctx.systemWriteAs`, roles `[SYSTEM_ROLE]`), so provisioning/migration
  jobs could not set it without making the key system-only (which kills
  self-service). The publicstatus continuity migration had to fall back to raw SQL.

  `access.withSystem(roles)` composes any role preset with `SYSTEM_ROLE`
  (`access.withSystem(access.admin)` → `["system", "TenantAdmin", "Admin",
"SystemAdmin"]`). The key stays human-writable — `checkWriteAccess` only collapses
  to system-only when system is the _sole_ writer — so tenant admins keep editing it
  via configEdit while provisioning can set it via `systemWriteAs`. The managed-pages
  branding keys now use it; apps with custom roles get the same path. customCss stays
  admin-only (not in the continuity-migration set — least privilege).

## 0.56.1

## 0.56.0

### Minor Changes

- c9a0ef8: Validate Custom-Screen `dispatcher.write` QNs at compile/boot/CI (#403) and
  harden config system-scope writes (#405).

  **#403 — Write-handler QN safety**

  - Codegen exports `WriteHandlerQn`, `TypedDispatcher`, and
    `createTypedDispatcher()` from `@app/define` when handler QNs are known.
  - Boot scans app `src/**` for string-literal `dispatcher.write(...)` calls and
    fails fast against the live registry (`validateAppCustomScreenWriteQns`).
  - Shared extractor in `write-handler-qn-extract.ts` for boot validation.

  **#405 — Config scope write gate**

  - `checkScopeWriteAccess`: writing at `scope: "system"` requires `SystemAdmin`
    (or `SYSTEM_ROLE`), not merely `TenantAdmin` membership in `access.write`.
    Blocks raw-dispatch elevation to the platform-default row on tenant-scoped keys.

## 0.55.1

## 0.55.0

### Minor Changes

- 17fa9ee: Settings-Hub: place the audience nav-groups inline in app workspaces

  The self-populating Settings-Hub previously always surfaced as its own
  `settings` workspace (a separate top-bar switcher entry) in workspace-mode apps.
  An app can now place the hub **inline** in its own workspaces instead: reference
  a generated audience parent — `config:nav:audience-system` / `…-tenant` /
  `…-user` — in an `r.workspace({ nav: [...] })` list, and `buildAppSchema`
  expands that audience's child screen-navs into the same workspace (so the nav
  slice keeps them) and drops the audience from the standalone switcher.

  - **Per-persona placement:** put `config:nav:audience-system` in a SystemAdmin
    workspace and `config:nav:audience-tenant` in a tenant-admin workspace, and the
    platform-default vs. tenant-override screens land in the right sidebars with no
    extra "Einstellungen" tab.
  - **Nothing vanishes:** an audience no workspace places stays reachable in the
    standalone settings workspace (a dev-only warning names it so the author can
    place it). Place every audience → the standalone tab disappears. Place none →
    behaviour is unchanged (the whole settings workspace is appended as before).
  - **Boot guard:** `validateWorkspaces` exempts exactly the three generated
    `config:nav:audience-<scope>` QNs (synthesised after boot, never `r.nav()`-
    registered); every other unregistered nav ref still throws, and a typo'd
    audience QN is dropped by the render-time slice filter.

## 0.54.0

### Minor Changes

- a565b61: Settings-Hub: derive one screen per scope-level a masked config key spans

  The self-populating Settings-Hub (`buildConfigFeatureSchema`) now follows the
  config cascade `env → system → tenant → user` when deriving screens. Previously
  a masked key produced exactly one `configEdit` screen at its declared home
  scope; now it produces a screen at **every** scope from `system` down to its
  home, so a single declaration drives the whole per-role settings UI.

  Per-level access:

  - **Home scope** keeps the key's full `access.write` set (unchanged).
  - **A broader scope** (e.g. a tenant-home key at the system level) is offered
    only when the key's write-set names an _elevated_ role for that level —
    `SystemAdmin` at system, `TenantAdmin`/`Admin` at tenant — and the generated
    screen is gated to exactly that intersection.

  Effect: a tenant-home key such as SMTP whose write-set is the `admin` preset
  (`∋ SystemAdmin`) now yields a **SystemAdmin-only Plattform screen** (set the
  platform-wide default) **plus** the existing tenant screen (the per-tenant
  override) — the "sysadmin sets the default, tenant admin overrides" cascade is
  now buildable purely by declaring `mask`, with no hand-written `r.screen`/`r.nav`.
  A key whose write-set names no elevated role gets no broader screen (the
  write-set is the opt-in).

  Hardening: a masked key whose effective write-set at a scope is only the
  internal machine actor (`access.system` = `["system"]`) no longer surfaces in
  the human hub at all (build-time exclusion). Such a field could otherwise render
  on a screen made visible by co-grouped human keys yet reject the viewer's write.

  No app changes are required to adopt; apps that only declared `mask` on
  tenant-home keys with the default `admin` write-set will gain the new
  SystemAdmin platform-default screens automatically.

- e7a7809: Projection rebuild: live-tail catch-up (#363 Phase 2)

  Single-stream `rebuildProjection` now drains the event log with a cursor-paged
  catch-up loop instead of a single up-front SELECT. It replays the bulk
  lock-free (live synchronous applies keep writing to the live table; READ
  COMMITTED makes each fresh batch see their newly-committed events), then takes a
  brief `ACCESS EXCLUSIVE` fence on the live table and drains the final delta
  before the swap.

  Effect: events committed to the live table **during** the replay are no longer
  lost at swap — Phase 1's single-pod write-loss window is closed. The trade is a
  marginally longer cutover (final-drain + swap, bounded by a `lock_timeout`)
  versus Phase 1's swap-only window.

  Cutover semantics: a concurrent synchronous apply blocked on the fence is one
  atomic append+apply transaction. The guaranteed invariant — independent of
  Postgres version — is that the event and its projection row commit or roll back
  **together**: no orphaned event-without-row is possible. (Observed on PostgreSQL
  18: when the fence releases, the blocked write re-resolves to the swapped-in
  table by name and commits rather than erroring — but don't design around
  "blocked writes always succeed"; only the atomicity is guaranteed.)

  Boundary unchanged: this is **not** multi-pod zero-downtime. During a rolling
  deploy, old pods still running cannot read the new shape after the swap.
  End-to-end zero-downtime additionally needs app-author expand/contract
  discipline (see `docs/plans/projection-aware-migrations.md`). Multi-stream
  projections are unaffected — they have no inline apply, the consumer `FOR UPDATE`
  already fences the dispatcher, and the cursor catches the tail after the swap.

  New optional `rebuildProjection` deps: `fenceLockTimeoutMs` (cutover fence
  timeout, default 5000ms).

- b2e3a56: Projection rebuild is now online (#363, Phase 1): both `rebuildProjection` and
  `rebuildMultiStreamProjection` replay into a shadow table in a private
  `kumiko_rebuild` schema and atomically swap it into `public` as the last step,
  instead of holding an `ACCESS EXCLUSIVE` lock on the live table for the entire
  replay via in-place `TRUNCATE`. The live projection table stays readable and
  writable throughout the replay; only the final swap takes a brief lock.

  Notes:

  - Rebuild now requires `CREATE` privilege to provision the shared rebuild schema
    (fails loud if missing).
  - The shadow table is rebuilt from `EntityTableMeta`, so an index hand-added in
    a migration but absent from meta is not reconstructed; a partial index whose
    WHERE the renderer can't express is rejected up-front.
  - This is not multi-pod zero-downtime on its own: events written to the live
    table during the replay are not reflected in the shadow. Rebuild on a quiet
    entity or during a write-pause (live-tail catch-up is a later phase).

- 1135437: Date/Calendar-Inputs vereinheitlicht (#369): `date` und `timestamp` teilen jetzt
  eine gemeinsame, tippbare Eingabe mit Jahres-/Dekaden-Dropdown im Kalender. Datümer
  sind überall direkt tippbar (locale-aware Parse), nicht mehr nur per Klick. Neu pro
  Feld konfigurierbar: `min`/`max` (Picker-Range + Zod-Durchsetzung beim Write) und
  `locale` (Anzeige-/Eingabe-Format) auf `date`/`timestamp`/`locatedTimestamp`-Feldern.

## 0.53.0

## 0.52.0

## 0.51.0

### Minor Changes

- ac282fb: config: wire the generic `backing:"secrets"` dispatch for system-scoped keys

  A config key declared `createSystemConfig(type, { backing: "secrets" })` now
  stores and reads its value through the **secrets store** (envelope-encrypted,
  audited, at `SYSTEM_TENANT_ID`) instead of the `config_values` projection —
  completing the previously declared-but-guard-rejected `backing` field
  (framework#333 footgun-guard from #376).

  - **Reads** dispatch in the resolver (`get`/`getWithSource`/`getCascade`/
    `getCascadeBatch`): a `backing:"secrets"` key resolves its system rung from
    the secrets store via an injected `ConfigSecretsReader`, threaded per-call
    from the request's `ctx.secrets` (the resolver is framework-auto-created
    while `ctx.secrets` is app-provided — only the request context sees both).
    Internal `ctx.config(handle)` reads receive the revealed plaintext; the
    `values`/`cascade` query handlers mask it like an `encrypted` key so the
    plaintext never reaches the UI. `readiness` gates `required` secrets keys for
    free (it shares `getCascadeBatch`).
  - **Writes** dispatch in `config:write:set` / `config:write:reset` into
    `ctx.secrets.set` / `.delete` (system tenant), with the same JSON
    serialization a config row uses so reads round-trip.
  - **Boot-guard** (`validateConfigKeyBacking`) now allows system-scoped
    `backing:"secrets"`; the permanent `scope !== "system"` rejection stays
    (secrets are flat per `(tenant,key)` and do not cascade).
  - A `backing:"secrets"` read/write without `extraContext.secrets` (+ a
    MasterKeyProvider) throws loud at request time — never silently degrades to
    config-encrypted storage.

  Blast-radius zero: no shipped config key declares `backing:"secrets"` today.
  The capability is proven end-to-end by a real-HTTP integration test (set →
  secrets store, masked cascade/values, revealed internal read, reset clears).

- b40187f: projections: first-class single-run rebuild trigger (`enqueueProjectionRebuild` + built-in job)

  Phase 3 of `projection-aware-migrations`. Adds a self-service way to rebuild one
  projection — the remediation the #361 fail-loud path points at, plus a manual
  rebuild trigger and a post-upcaster refill path that no schema-diff would catch.

  - **`enqueueProjectionRebuild(projection, { db, registry, jobRunner? })`** (migrations):
    with a `jobRunner` and the rebuild job registered (jobs feature composed) it
    dispatches a tracked, retryable job (`read_job_runs` + `read_job_run_logs`,
    `jobs:write:retry`); without jobs it falls back to a synchronous inline
    `rebuildProjection` — today's behaviour, framework-pure. Capability detection
    is via `registry.getJob`, not `hasFeature` (deterministic, no toggle-runtime
    dependency). Returns a `{ mode: "dispatched" | "inline" }` discriminated union.
  - **Built-in job `jobs:job:projection-rebuild`** registered by the `jobs`
    bundled-feature — available automatically whenever `jobs` is composed, no
    extra feature to opt into. Its worker calls `rebuildProjection`.
  - **JobRunner** now injects its own `registry` into every job context, matching
    the `JobContext` contract (`registry: Registry`) — workers no longer depend on
    the app author duplicating the registry into `context`.

  Proven by real-pg/real-redis integration tests: inline fallback (no jobs) and
  end-to-end dispatch → BullMQ worker → projection refilled + run tracked.

## 0.50.0

### Minor Changes

- 8ca4a27: api: server-side Origin-allowlist guard for CSRF hardening (#340)

  Adds `AuthRoutesConfig.allowedOrigins` — an opt-in server-side Origin check on
  cookie-authenticated, state-changing `/api/*` requests, layered on top of the
  double-submit CSRF token. Apps that widen the auth cookie across subdomains via
  `auth.cookieDomain` should set it to the apex + admin host (never tenant
  subdomains): a wide cookie otherwise lets an XSS on any subdomain read the
  JS-readable csrf cookie and forge an authenticated request. Requests without an
  Origin header fall back to `Sec-Fetch-Site` and then to the CSRF token, so the
  guard is defense-in-depth rather than a replacement.

  Potentially breaking for consumers that set `cookieDomain`: the framework now
  **fails closed** — `buildServer` refuses to boot when `cookieDomain` is set but
  `allowedOrigins` is empty, because a wide cookie without an Origin check leaves
  the JS-readable csrf cookie exploitable from any subdomain. Set `allowedOrigins`
  (apex + admin host) in the same deploy as the upgrade, or set
  `unsafeSkipOriginCheck: true` to opt out explicitly for a single-host deployment.

- 6b16dd9: feat(migrations): fail-loud for managed projection tables emptied without a resolvable rebuild (#361)

  `runPendingRebuilds` accepts an optional `thisRunTables` (the tables freshly
  queued by `queueRebuildsFromMarkers` in this apply run). Rebuild markers only
  ever list managed projection tables, so a table emptied **this run** that no
  registered projection resolves means the owning feature is missing from the
  composition — its projection is now silently empty. Such tables are reported
  in a new `unresolvedManaged` field on `PendingRebuildRun` and logged at error
  level, instead of being silently drained.

  Non-fatal by design: the queue still drains (no sticky-stuck re-apply), and
  pre-existing pending tables (not in `thisRunTables` — indistinguishable from
  legacy unmanaged markers or composition drift) stay in the benign `unmapped`
  set, so upgrades with old markers don't break. Without `thisRunTables` the
  behavior is unchanged (every unmapped table → `unmapped`). Follow-up to #356.

### Patch Changes

- f06e33a: config: dev-path ENV→app-override bridge + values.query shows inherited defaults

  Closes the two config-provisioning leftovers:

  - **runDevApp now wires the ENV→config-app-override bridge** (keys with `env:`
    get their env value as the app-override default), symmetric to runProdApp —
    previously only the prod path did. The envSource is injectable (default
    `process.env`); a caller-supplied configResolver still overrides the default.

  - **config:query:values now resolves through the full cascade** (the same path
    as config:query:cascade), so the admin mask shows an inherited default (e.g.
    an ENV-bridged app-override) instead of falling back to keyDef.default and
    hiding it. This unifies the two read handlers so they can no longer diverge.

  - **inheritedToTenant:false redaction now strips every inherited platform rung**
    (system-row, app-override, computed, default), not only system-row. Surfacing
    the app-override otherwise re-opened the leak the redaction closes: a
    tenant-side viewer would see the platform ENV value through the app-override
    rung. Blast-radius zero — no shipped config key declares inheritedToTenant:false.

- d8330bc: config: enforce inheritedToTenant redaction and guard backing:"secrets"

  Completes two provisioning fields that #370 declared but left inert:

  - **inheritedToTenant:false now redacts.** A tenant-side viewer (any role other
    than SystemAdmin) no longer receives the inherited system-row value — nor the
    fact that it is set — through `config:query:cascade` or `config:query:values`.
    Redaction strips the system-row level (value AND hasValue), recomputes the
    cascade winner, and runs before encrypted-masking so a masked key cannot leak
    "is set". SystemAdmin still sees the value.

  - **backing:"secrets" now fails boot instead of silently degrading.** A
    non-system scope is rejected permanently (secrets are flat per (tenant,key),
    no cascade); a system scope is rejected until the secrets read/write dispatch
    is wired (framework#333). Previously the value persisted as config-encrypted
    behind the declaration, losing envelope-encryption / rotation / audit.

  Blast radius zero: no shipped config key declares either field today.

- d8083ae: test(es-ops): refactor seed-migration integration tests onto a real dispatcher

  The `runner`/`context` es-ops integration tests built a fake dispatcher via
  `makeMockDispatcher` (bun:test `mock()`), violating the no-fake-dispatcher rule
  — both were grandfathered into `MOCK_GUARD_ALLOWLIST`. They now boot a real
  `createDispatcher` with a real feature (mirroring the boot-time seed path in
  `run-prod-app`, which calls `dispatcher.write` directly — no HTTP route) and
  assert against real event-store rows. The two allowlist entries are removed.

  Also corrects a misleading tx-isolation comment in the seed-migration context
  builder: `systemWriteAs` writes run in the dispatcher's own transaction on
  `context.db` and survive a runner rollback (hence seeds must be idempotent) —
  they are not nested as a savepoint that rolls back with the runner tx. This is
  now verified by the `dispatcher-writes vor throw bleiben committed` test.

- eabad73: migrate-generator: locale-independent table sort, shared `compareByCodepoint` (#367, follow-up to #330)

  `snapshotFromMetas` sorted tables with `String.localeCompare`, whose order
  depends on the runner's ICU locale. The snapshot is serialized to byte-exact
  JSON and the order carries into the generated migration SQL, so the committed
  bytes could drift between a macOS dev box and Linux CI — worse than the manifest
  case (#330) because migrations are diffed and replayed. It now uses a codepoint
  comparator, extracted to `utils/compareByCodepoint` and shared by feature-manifest
  (#330's file-local copy removed) and collect-table-metas (an in-process equality
  key, switched for consistency). A regression test feeds mixed-case table names
  and asserts codepoint order. Byte-identical for all current artifacts (table
  names are lowercase snake_case, for which codepoint and locale order agree).

## 0.49.0

### Minor Changes

- 5d8b8ca: config-provisioning: coherent user-scope cascade, ENV→config bridge, and a self-populating Settings-Hub

  Three additive, non-breaking pieces for declarative config provisioning:

  - **User-scope cascade (D8):** a `user`-scope config key now falls through to the
    system-row (`user-row → tenant-row → system-row → default`) on both the UI
    cascade and the hot `getWithSource` path, so a system-seeded default is visible
    to a user lookup. Previously the system-row was skipped for user-scope keys.

  - **ENV→app-override bridge:** `env` on a config key binds an environment variable
    as the app-override layer of the cascade. `buildEnvConfigOverrides(registry, env)`
    is wired into `runProdApp`, so a key gains an ENV default by adding one field —
    no factory switch. `env`, `inheritedToTenant`, and `backing` are optional fields
    on the existing `createTenantConfig`/`createSystemConfig`/`createUserConfig`.

  - **Self-populating Settings-Hub:** a config key with the new `mask` field
    (`{ title, icon?, order? }`) is automatically surfaced as a settings UI — per
    scope an audience group, per (feature × scope) a `configEdit` screen + nav,
    derived from the key type. No manual `r.screen`/`r.nav`. `buildConfigFeatureSchema`
    runs inside `buildAppSchema` (find-or-create `config` FeatureSchema); in
    workspace-mode apps a synthetic `settings` workspace is appended (skipped for
    workspace-less apps so they don't flip into nav-filter mode). Screens honor a new
    per-field `fieldLabels` override so `mask.title` flows to the label without the
    `__config-edit__` convention. The `config` bundled-feature ships the generic
    `config.settings.*` audience labels via `configClient()`
    (`@cosmicdrift/kumiko-bundled-features/config/web`).

  No existing config key declares `mask`/`env`, so `buildConfigFeatureSchema` returns
  empty and `buildAppSchema` output is unchanged for current apps.

## 0.48.1

### Patch Changes

- ec22610: feature-manifest: sort by codepoint instead of `localeCompare` (#330)

  `buildManifestFromRegistry` sorted features, config keys and secrets with
  `String.localeCompare`, whose ordering depends on the running machine's ICU
  locale. Since the manifest is serialized to byte-exact JSON (the
  `use-all-bundled` and enterprise generators commit it, and docs CI byte-compares
  it), the bytes could drift between a macOS dev box and Linux CI. The three sorts
  now use a locale-independent codepoint comparator.

  Byte-identical for all current manifests — every feature name and qualified
  name is lowercase-kebab, for which codepoint and locale order agree. This closes
  the latent cross-locale drift before a mixed-case or non-ASCII name ever
  introduces it.

## 0.48.0

### Minor Changes

- 2852197: migrate-generator: projection-aware migrations (#356)

  Schema changes to a **managed** projection (`r.entity`) that cannot apply
  in-place against existing rows — `NOT NULL` without a default, a `UNIQUE` index,
  `SET NOT NULL`, a type change, or a dropped/renamed column — are now generated as
  `DROP TABLE` + `CREATE TABLE` (new shape) instead of an additive `ALTER` that
  dies on the very rows the projection rebuild discards anyway. The rebuild marker
  refills the recreated table from the event stream. **unmanaged** tables
  (`defineUnmanagedTable`, real non-derived data) keep additive `ALTER` plus the
  commented `-- DESTRUCTIVE` statements, unchanged.

  The split is driven by `EntityTableMeta.source`, which lives in the
  generate-time snapshot — so it is a pure generate decision: no registry
  awareness, no runtime DDL-from-code, the apply path stays a dumb SQL runner.
  `rebuildTablesFromDiff` is now managed-only (unmanaged tables are never
  event-rebuilt) and includes the recreate cases.

  Caveat: DROP+CREATE empties the projection before the rebuild refills it, so it
  is only safe for projections whose events carry every column. A managed table
  with columns that are NOT derivable from the event stream must not rely on this
  path — that is a data migration, not a schema change.

## 0.47.0

## 0.46.0

### Minor Changes

- 7751b71: migrate-generator: ride-along columns/indexes + Drift Layer 3 (#347)

  The migration generator (`collectTableMetas` / `kumiko schema generate`) derived
  each table's DDL purely from `entity.fields`, so columns and indexes that live
  only on a separate Drizzle `table()` object — secrets' `envelope`/`metadata`/
  `last_rotated_at` + the `(tenant, key)` uniqueIndex — were invisible and never
  emitted. The first prod write then hit a missing column (publicstatus#116).

  - **New `r.entity(name, def, { table })`** declares a backing table as the
    physical DDL truth for tables whose columns can't be expressed via the
    field-DSL (jsonb-without-default, `now()`-default). It is validated as a
    superset of the entity's fields and is the single table shared by the
    generator, the implicit projection (executor + rebuild) and the test-push —
    restoring the generate==push invariant. Wired on `secrets` and `delivery`.
  - **Drift Layer 3:** the boot-time schema-drift gate now also column-diffs each
    existing snapshot table against the live DB. A migrated-but-incomplete table
    fails boot with a `SchemaDriftError` + regen hint instead of a runtime-500.

## 0.45.1

### Patch Changes

- 3053ef8: `kumiko-schema apply` legt jetzt die Framework-Infra-Tabellen (event-store + pipeline-state: `kumiko_events`, `kumiko_snapshots`, `kumiko_archived_streams`, `kumiko_event_consumers`, `kumiko_projections`) idempotent mit an. Bisher erfasste `generate` nur Entity-read-Tabellen — eine Greenfield-DB (erste App ohne legacy-drizzle-Cutover) hatte daher kein `kumiko_events`, und `runProdApp` brach beim ersten event-store-Zugriff ab. Bestands-DBs sind über den `tableExists`-Gate unberührt (no-op).

## 0.45.0

## 0.44.0

### Minor Changes

- b082294: feat(engine): add `createDecimalField` — exact `numeric(precision, scale)` column

  A new field primitive for values that need fractional precision the integer
  `number` field and the cents-based `money` field can't hold: interest rates,
  percentages, ratios, measurements. `precision` and `scale` are required (no
  truncating default). Stored as Postgres `numeric(p,s)`; pg returns it as a
  string, which the centralized read-coercion surfaces as a JS `number` (safe ≤
  2^53, same trade-off as `bigInt` mode:"number"). Write-boundary Zod validation
  rejects over-scale / over-precision input instead of silently rounding.

## 0.43.0

## 0.42.0

## 0.41.1

### Patch Changes

- 1e7a66e: `executor.detail` liefert jetzt die Stream-Version statt der Read-Row-Version. Lifecycle-Writes via `ctx.appendEvent` bumpen den Event-Stream, ohne `row.version` anzufassen — ein entityEdit, das `detail.version` als optimistic-lock-Basis lädt, lief danach in ein garantiertes `version_conflict` (Prod-Repro: `incident:open` appended das Eröffnungs-Update → Stream v2, Row v1 → Incident-Edit konnte nie speichern). Die Policy „stream-version authoritative" galt im Update-Pfad bereits; detail zieht nach.

## 0.41.0

### Minor Changes

- 3f2d6ee: Event-Store-Doppelkodierungs-Fix, lokaler Event-Dispatcher in runProdApp, update-only entityEdit, actionForm-Extension-Kontext, konfigurierbare custom-fields-Rollen

  - **fix(event-store):** `insertSubsequentEventRow` (und die es-ops-Raw-Inserts
    - `upsertSnapshot`) banden vor-stringifiziertes JSON an `::jsonb` — Bun.SQL
      kodiert einen JS-String erneut, gespeichert wurde ein jsonb-**String-Skalar**
      statt einem Objekt. Betroffen waren alle Events mit version>1 seit dem
      bun-db-Cutover. payload/metadata/state binden jetzt als Objekte; SQL-seitige
      Konsumenten (`payload->>'x'`, GDPR-Pipeline, Ops-Tools) sehen wieder echte
      Objekte. Bestandsdaten brauchen einen einmaligen Repair
      (`SET payload = (payload #>> '{}')::jsonb WHERE jsonb_typeof(payload)='string'`).
  - **feat(runProdApp):** Lokaler Event-Dispatcher per Default an —
    Single-Container-Deployments hatten KEINEN Prozess, der
    `r.multiStreamProjection`-Projektionen anwendet (Read-Seiten blieben still
    leer). `createApiEntrypoint` bekommt `eventDispatcher: { runLocal: true }`
    (processLane "both"), runProdApp aktiviert das automatisch; Opt-out via
    `eventDispatcher: { disabled: true }` für Setups mit dezidiertem Worker.
  - **feat(entityEdit):** `allowCreate?: boolean` / `allowDelete?: boolean`
    (Default true) für Lifecycle-Entities ohne CRUD-create/-delete: unterdrückt
    den automatischen „+ Neu"-Button auf entityList-Screens bzw. den
    Löschen-Button im Update-Form; Aufruf ohne entityId rendert bei
    `allowCreate: false` einen Fehler statt eines Create-Forms.
  - **feat(actionForm):** Extension-Sections erhalten die initialen Form-Values
    (inkl. `?param=`-Prefill) als `initialValues` — Kontext-Sections wie eine
    Update-Timeline können den Row-Bezug daraus lesen.
  - **feat(custom-fields):** `createCustomFieldsFeature({ valueWriteRoles,
fieldDefinitionListRoles })` — Apps mit eigenem Rollen-Vokabular (z.B.
    "Admin"/"Editor") überschreiben damit die RBAC der von der
    CustomFieldsFormSection hart dispatchten Bundle-QNs (set/clear-custom-field,
    field-definition:list). Default unverändert TenantAdmin/TenantMember.

## 0.40.1

### Patch Changes

- 667c79b: Boot-Validator: `version` als pick/map-Quelle in Action-Extractoren erlauben — Row-Meta (id, version) ist auf jeder Entity-Row vorhanden ohne Entity-Field zu sein; `pick: ["id", "version"]` ist das Standard-Payload für optimistic-lock-Lifecycle-Writes. Der 0.40.0-Validator lehnte solche rowActions beim Boot ab (Prod-CrashLoop publicstatus).

## 0.40.0

### Minor Changes

- d10ef7e: Drei geteilte Bausteine aus den Review-Findings (studio#36/#46, studio#15, enterprise#95):

  - **Pending-Rebuild-Queue** (`@cosmicdrift/kumiko-framework/migrations`):
    `queueRebuildsFromMarkers` + `runPendingRebuilds` persistieren
    Projection-Rebuilds in `kumiko_pending_rebuilds` — ein fehlgeschlagener
    Rebuild nach `schema apply` bleibt pending und wird beim nächsten Lauf
    nachgeholt, statt still verloren zu gehen.
  - **`parseEnvDryRun`** (`@cosmicdrift/kumiko-framework/env`): ehrliches
    `Partial<z.infer<S>>` für den KUMIKO_DRY_RUN_ENV-Pfad statt
    `({} as Shape)`-Cast — vorhandene Werte typisiert gecoerct, wirft nie.
  - **`buildManifestFromRegistry`** (`@cosmicdrift/kumiko-framework/engine`):
    die Feature-Manifest-Extraktion als geteilter Builder (+ `Manifest*`-Typen,
    `serializeManifest`, optionaler `tier`-Tag + Feature-Filter) — der
    use-all-bundled-Generator nutzt ihn bereits, der enterprise-Fork folgt.

- 64a51ac: Review-Findings Rest-Welle (PR #323, 35 Findings). Verhaltens-relevant:

  - **Boot strenger** (kann bisher durchlaufende Boots brechen): required
    Config-Keys mit computed bzw. non-empty default sind jetzt Boot-Fehler;
    Action-Field-Refs (pick/map/visible.field/entityId) werden gegen die
    Entity-Felder validiert; zwei Entities mit gleichem tableName werfen.
  - **readiness:** SystemAdmin-gated required-Keys zählen jetzt im Verdict
    jedes Callers (skipAccessFilter im Rollup) — `ready` kann von true auf
    false kippen, wo vorher Lücken unsichtbar waren; mail-foundation
    Provider-Key ist required.
  - **access.admin-Preset** enthält zusätzlich `TenantAdmin`.
  - **user-data-rights:** runForgetCleanup wählt savepoint-FIRST — nested
    BEGIN in Transaktionen (Prod-Incident-Klasse) behoben.
  - **dev-server:** `extraRoutes`-deps zwischen runProdApp und
    createKumikoServer geteilt (`ExtraRoutesSystemDeps`); createKumikoServer
    reicht jetzt den nackten ioredis-Client statt des TestRedis-Wrappers.
  - **renderer-web:** Theme-Restore concurrent-render-sicher (useState-Lazy);
    ConfigSourceBadge kollabiert Operator-Quellen auf Tenant-Screens.
  - **renderer/headless:** evalFieldCondition als Single-Source re-exportiert.

## 0.39.0

### Minor Changes

- 34cb1f7: Bug-Bash-2 Wave F2: Renderer-Fixes + Auth-Vorarbeit

  - Settings-Screens: "Vorgabe"-Block (Source-Badge + Cascade-Disclosure)
    erschien doppelt pro Feld — RenderEdit reichte denselben Callback als
    labelAppendix UND fieldAppendix durch. Jetzt zwei getrennte Callbacks.
  - timestamp-Felder: neues TimestampInput konvertiert zwischen lokaler
    Wall-Clock (datetime-local) und UTC-Instant mit `Z` — Saves endeten
    vorher in 422 invalid_format. locatedTimestamps bleiben Wall-Clock
    (neues wallClock-Flag im EditFieldViewModel/FieldInputProps).
  - Validierungsfehler: errors.validation.\*-Keys (Zod-4-Codes +
    Framework-Codes) in den de/en-Default-Bundles, Field interpoliert
    issue.params ({minimum} etc.) — vorher rohe Keys in der UI.
  - AuthRoutesConfig.cookieDomain: Domain-Attribut für beide Auth-Cookies
    (Cross-Subdomain-Login), Logout löscht Domain- und host-only-Variante.
    Pass-through via RunProdApp/RunDevApp-Auth-Options.
  - HostDispatchFn bekommt `search` (Query-String) für verlustfreie
    Host-Redirects (additiv).

## 0.38.0

### Minor Changes

- 0f093f1: Review-findings behavior wave (15 findings, incl. 1 High):

  - **framework:** `buildAppSchema` dev-assertion actually fires now — the JSON-roundtrip comparison could never detect leaked functions (both sides drop them identically); replaced with a `findNonJsonSafePath` walker that reports the offending path and treats PlatformComponent slots as opaque (High). TenantDb `readWhere` now permits NARROWING within the enforced `[own, SYSTEM]` scope (callers can exclude SYSTEM reference rows at the DB instead of post-filtering after a limit; widening remains impossible — covered by new where-merge tests). Boot-validator survives a missing `section.component` with the intended boot error instead of crashing. msp-rebuild throws `InternalError` consistently.
  - **headless:** `applyFormatSpec` priority renders its `emptyLabel` ("—") for empty values again instead of collapsing to "" (regression vs. the old callback); `escapeHtmlAttr` escapes `'` (superset of `escapeHtml`, restores the apostrophe-escaping legal-pages had before the dedup).
  - **renderer:** `dispatcherErrorText` passes `error.i18nParams` to translate — placeholders no longer render raw.
  - **dev-server:** SPA fallback also answers HEAD (parity with prod).
  - **bundled-features:** invite-accept checks alreadyMember directly against the memberships projection (the filtered `tenant:query:memberships` made re-invites into disabled tenants hit the unique constraint); template-resolver list excludes SYSTEM rows at the DB (no post-filter starvation of the 500-row limit); custom-fields form: clearing a stored value dispatches `clear-custom-field` and dirty compares against initialValues (covered by new clear-path tests); Stripe env accepts restricted `rk_` keys; tenant-switcher uses `||` so empty names fall back; `inviteEmailMismatch` error factory.

- ffcce8a: Review-findings quick-win sweep (29 findings across 24 PR reviews):

  - framework: `asEntityTableMeta` removed from the `bun-db` barrel (import via `db/query` shim instead — minor because it drops a public export); `toStoredEvent` now exported from the `event-store` barrel; `EventRow.tenantId` typed as `TenantId`; fallback-logger format unified to `[ns] msg` on both paths; search-payload collision warning deduped per entity:key and no longer mislabels contributor-vs-contributor collisions as Stammfield overwrites; `extractTableName` calls in projection-table-index carry an identifying context; `isFormatSpec` without cast; FieldFormatRegistry augmentation example uses the real `engine/types` subpath (verified compiling).
  - dev-server: shared `isKebabSegment` replaces three copies of `KEBAB_RE`; `dispatchSystemWrite` roles use the `ROLES` constant.
  - bundled-features: `isFileProviderPlugin` type guard exported from file-foundation and used instead of the blind cast (provider registration without `build()` now fails with a descriptive error); `enforceStockCap` JSDoc documents the TOCTOU caveat; assorted dead code and stale/misleading comments fixed.
  - headless: applyFormatSpec dev-warning in English.
  - docs: all `*.integration.ts` references corrected to `*.integration.test.ts`; use-all-bundled feature-manifest generation sorts configKeys/secrets deterministically (manifest regenerated).

- 7a00d80: Type reconciliation: `FeatureDefinition.entities/hooks/entityHooks` and every slot of `HookMap`/`EntityHookMap` are now optional (`?:`) — matching the documented runtime contract (hand-built definitions at system boundaries omit slots; the registry guards against that, pinned by the "slot robustness" tests since #95/#98/#210). The previous required typing was a compiler lie that forced `?.`/`?? {}` guards to contradict the types. All production read-sites now guard explicitly; the single remaining `as HookMap` in defineFeature is the documented engine-bridge for the per-slot signature erasure in hook registration.

### Patch Changes

- 8becbed: Enforce the archived-stream read-only contract on the CRUD executor path. `update`, `delete`, and `restore` now reject writes onto an archived aggregate with `ArchivedStreamError` (rolled-back transaction, no event lands) — matching the existing `ctx.appendEvent` behaviour. Previously these went through `append()` + `getStreamVersion()`, which ignore the archive flag, so entity-CRUD writes could silently land events on an archived stream while `loadAggregate` returned an empty slice for the same stream.

## 0.37.0

## 0.36.0

### Minor Changes

- d84a515: FormatSpec-Verbesserungen: isFormatSpec-TypeGuard, timestamp/date Locale-Optionen, applyFormatSpec nach headless verschoben, normalizeListColumn dev-warning für Funktions-Renderer, buildAppSchema dev-assertion für JSON-Safety

## 0.35.0

### Minor Changes

- 6553405: feat(screen-types): FieldFormatRegistry + FormatSpec ersetzen function-Renderer

  `FieldRenderer` akzeptiert keine Inline-Funktionen mehr — sie wurden von
  `JSON.stringify` in der `buildAppSchema → window.__KUMIKO_SCHEMA__`-Pipeline
  still gedroppt, was zu unsichtbaren Render-Fehlern führte.

  Neu: `FormatSpec` — deklarativer, JSON-sicherer Formatter-Typ:
  `{ format: "timestamp" }` | `{ format: "currency", symbol: "€" }` |
  `{ format: "boolean", trueLabel: "Ja", falseLabel: "Nein" }` |
  `{ format: "priority", prefix: "P" }` | `{ format: "date" }`

  Apps erweitern das Built-in-Set per module augmentation:

  ```ts
  declare module "@cosmicdrift/kumiko-framework" {
    interface FieldFormatRegistry {
      myFormat: { myOption?: string };
    }
  }
  ```

  `renderer-web` kennt alle Built-in-Keys; unbekannte App-spezifische Keys
  fallen auf `String(value)` zurück.

  Migration: Inline-Funktionen durch das passende `{ format: "..." }` ersetzen.

## 0.34.2

## 0.34.1

## 0.34.0

### Minor Changes

- 9be544f: feat(screen-types): declarative FieldCondition and RowFieldExtractor replace function props

  `FieldCondition` is now a JSON-safe union (`boolean | { field, eq } | { field, ne }`) instead of `(data, ctx) => boolean`. `visible`, `readOnly`, and `required` on `EditFieldSpec` and row-action props use the new declarative form. `RowFieldExtractor` props (`entityId`, `params`, `payload`) are also declarative (`"fieldName"` / `{ pick }` / `{ map }`). All function-form props are removed — they were silently dropped by `JSON.stringify` in schema-injection.

## 0.33.0

## 0.32.1

## 0.32.0

### Minor Changes

- 05c4447: Workspace-Navigation + Row-Action-Fehler sichtbar machen

  - `useBrowserNavApi` honoriert jetzt den dokumentierten NavTarget-Contract:
    `workspaceId` weglassen = aktueller Workspace bleibt. Vorher erzeugte
    `navigate({ screenId })` im Workspace-Mode einen Pfad ohne Workspace-
    Prefix, `parsePath` las das Screen-Segment als Workspace-Id und
    `WorkspaceShell` revertete sofort auf den Default-Screen — Edit-/
    Toolbar-Navigate-Aktionen wirkten tot.
  - `RowActionNavigate` hat ein neues optionales `entityId(row)`:
    entityEdit-Targets bekommen die Id als Pfad-Segment (`route.entityId`),
    `?id=`-Search-Params öffneten den Edit-Screen im Create-Mode.
  - navigate-Row-Actions setzen Search-Params jetzt NACH `nav.navigate`
    (pushState trägt keine Query — vorher gesetzte Params klebten an der
    alten URL, actionForm-Prefill kam leer an).
  - Row-Action-Writes verwerfen Failure-Results nicht mehr:
    `WriteFailedError` (neu exportiert, inkl. `dispatcherErrorText`) wird
    geworfen und im Web-Renderer als destructive Toast gezeigt (inkl.
    docsUrl). Vorher schloss der Confirm-Dialog kommentarlos — "Klick tut
    nichts". Confirm-Dialoge schließen außerdem auch bei rejected
    onConfirm statt offen zu hängen.

- 0009486: Theme-Persistenz, cancelTarget für actionForms, Login-Legal-Links

  - Theme-Wahl wird in localStorage persistiert (`kumiko:theme`) und beim
    ersten Mount restored (`applyStoredThemeMode` + `THEME_STORAGE_KEY`
    exportiert) — vorher war der Dark/Light-Toggle nach jedem Reload weg.
    FOUC-Schutz: Inline-Script-Snippet siehe tokens.ts-Header.
  - `ActionFormScreenDefinition.cancelTarget?: string | false`: entkoppelt
    den Abbrechen-Button vom Submit-`redirect`; `false` entfernt ihn
    (Single-Action-Screens wie „Test-Mail senden"). Boot-Validator prüft
    String-Targets wie `redirect`.
  - `LoginScreen` bekommt `legalLinks` (Impressum/Datenschutz unterhalb
    der Card) — der Login ist oft die einzige öffentliche Seite einer
    Admin-Domain und braucht erreichbare Legal-Links (Impressumspflicht).

## 0.31.1

### Patch Changes

- 6f79d05: `buildEntityTable` is now lock-step with `buildEntityTableMeta`: declared field defaults for `select`/`number`/`bigInt` survive the builder path (previously dropped — the meta on the table object, and thus `collectTableMetas`/test-stack DDL, disagreed with generated migrations), and `moneyAmount` carries `bigintJsMode: "bigint"` so money cents round-trip without precision loss past 2^53. New lock-step test guards both paths against future drift.

## 0.31.0

### Minor Changes

- b74ddbe: Readiness provider-gating: `ready` counts only the selected provider's keys.

  - `r.extensionSelector(extensionName, configKeyHandle)` — extension-point
    owners declare which config key selects the active provider
    (`mail-foundation` and `file-foundation` do). Without this, an app
    mounting smtp + inmemory transports showed `ready: false` forever for a
    tenant correctly running on inmemory.
  - Readiness gating counts a provider-feature's required keys and secrets
    only while that provider is the selected one. Applies to
    `readiness:query:status` AND `config:query:readiness`. Features without
    a selector-gated registration count unconditionally, as before.
  - `RegistrarExtensionRegistration.featureName` — the registry annotates
    each usage with its owning feature at merge time.
  - `buildProviderSelectionGate` exported from the config barrel.
  - Registry-build fails on duplicate selectors, selectors for undeclared
    extensions, and unknown selector keys.

- 5b1a594: `collectTableMetas(features)` (new export from `/db`): canonical `ENTITY_METAS` source for `kumiko schema generate` that covers the same table sources as the test-stack auto-push — entities, unmanaged tables, `r.projection`, `r.multiStreamProjection` (with table) and `r.rawTable`. Previously the canonical schema.ts template only collected entities + unmanaged tables, so projection-only tables (e.g. billing-foundation `read_subscriptions`, jobs `read_job_runs`) never landed in app migrations and the first prod write crashed (#255). Also exports `extractTableInfo`/`asEntityTableMeta` from `/bun-db`.

## 0.30.0

### Minor Changes

- 00020b4: Readiness rollup: one call answers "is this tenant fully configured?" across config AND secrets.

  - `r.secret(name, { required: true, ... })` — new `required` flag on secret
    declarations, mirroring the config-key flag. `mail-transport-smtp`
    (smtp.password) and `file-provider-s3` (s3.secretAccessKey) mark theirs.
  - `ctx.secrets.has(tenantId, key)` — metadata-only existence probe on
    SecretsContext: no decryption, no `tenantSecretRead` audit event. Use it
    for readiness checks; `get()` stays the audited value read.
  - New bundled feature `readiness` (requires `config` + `secrets`):
    `readiness:query:status` returns `{ missingConfig, missingSecrets, ready }`
    for the calling tenant — the settings-checklist call for admin UIs.
    `config:query:readiness` deliberately refused a `ready` verdict (it can't
    see secrets); this feature sees both, so it may verdict.
  - `collectMissingRequiredConfig` exported from the config barrel — the same
    cascade + access filter `config:query:readiness` uses, reusable.
  - **Behavioral change (intended):** a missing required secret at build time
    (SMTP password, S3 secret-access-key) now throws `UnconfiguredError`
    (422, code `unconfigured`) instead of a bare `Error` (500) — the use-time
    mirror of the config-key change in #272. New `requireSecretSet` helper in
    `foundation-shared`. Pinned end-to-end in the mail-foundation and
    file-foundation integration tests.

## 0.29.0

### Minor Changes

- f9d41ae: Tenant-config readiness: declare required config keys, query what's missing.

  - `createTenantConfig("text", { required: true, ... })` — new `required` flag on
    config-key declarations. Semantics: the tenant must supply a real value before
    the owning feature works; for text keys an empty/whitespace value counts as unset.
  - New query `config:query:readiness` returns the flat list of required keys that
    still lack a usable value for the calling tenant/user — resolved through the same
    cascade as `ctx.config()`, so it can never drift from what handlers will see.
    No boolean "ready" verdict on purpose: secret-presence is queryable via the
    secrets list-handler; UIs compose both.
  - `config:query:schema` now exposes the `required` flag per key (UI form rendering).
  - New `UnconfiguredError` (422, code `unconfigured`, i18nKey `errors.unconfigured`)
    subclassing `UnprocessableError` — `requireNonEmpty` throws it instead of a bare
    `Error`, so clients can route the user to the settings screen. `requireDefined`
    now throws `InternalError` (500): undefined there is a registry misconfiguration,
    a developer bug, not a tenant gap.
  - `mail-transport-smtp` (host/from/authUser) and `file-provider-s3`
    (bucket/region/accessKeyId) mark their must-configure keys `required: true`.

- 3186d8a: Tenant-Switcher zeigt Tenant-Namen statt UUID-Präfix: `tenant:query:memberships` reichert jede Membership um `tenantName`/`tenantKey` aus der tenants-Projection an, `GET /auth/tenants` reicht beides als `name`/`key` durch (`TenantSummary` erweitert), und der TenantSwitcher rendert `name > key > UUID-Präfix` — die `tenantName`-Prop bleibt als App-Override erhalten. Vorher waren Seed-Tenants (`00000000-…0001/0002`) im Switcher ununterscheidbar.

### Patch Changes

- 290a05b: Fix dead docs links in the error-reason i18n texts (en + de): the targets
  `/{en,de}/architecture/*` and `/en/features/feature-toggles/` never existed on
  docs.kumiko.rocks. Links now point to the real pages (`/en/concepts/commands/`,
  `/en/guides/field-level-permissions/`, `/en/feature-reference/feature-toggles/`);
  the state-machine link is dropped until a target page exists. German texts link
  to the English pages — the docs site is single-locale by design.

## 0.28.0

### Minor Changes

- 743db9b: extraRoutes-deps liefern jetzt `registry` + `dispatchSystemWrite` (runProdApp + createKumikoServer/runDevApp) — das Wiring, das `createSubscriptionWebhookHandler` für Provider-Webhook-Routen braucht. Dazu: `KumikoServer`/`ApiEntrypoint`/`TestStack` exponieren den Command-Dispatcher, `createSystemUser` nimmt optionale `extraRoles` (kein Access-Bypass für die system-Rolle — Ziel-Handler gaten auf explizite Rollen wie SystemAdmin).
- e42fef9: `r.describe(text)` — features declare a one-to-three-sentence docs-lead that flows
  into `FeatureDefinition.description` and the generated feature-manifest. All bundled
  features ship descriptions; the docs feature-reference pages render them as lead
  paragraphs.

## 0.27.0

### Minor Changes

- ea365d1: feat(cap-counter): `enforceStockCap` für Bestands-Caps (max N Entities)

  Plus `countWhere(db, table, where)` aus `@cosmicdrift/kumiko-framework/db`
  exportiert — der Live-Count (`SELECT COUNT(*)`), den ein Stock-Cap-Caller
  braucht, um `current` zu bestimmen. War bisher nur intern (`bun-db/query`).

  Reine Funktion für Stock-Caps (Bestand: „max 5 Components") neben den metered
  Flow-Caps (`enforceCap`/`enforceRollingCap`). Der Caller zählt die Projektion
  live (`count(*) WHERE tenant_id`) und übergibt `current` — kein gespeicherter
  Counter, kein Increment/Decrement, drift-frei (Delete gibt den Slot sofort
  frei). Gibt ein `StockCapResult` zurück statt zu werfen: der Caller entscheidet
  den HTTP-Status (ein erreichtes Stock-Limit heißt „Upgrade nötig", nicht 429).
  Nutzt die bestehenden `CAP_TOLERANCES` (`hardSlot` = exakte Grenze, kein Buffer).

## 0.26.0

## 0.25.0

### Minor Changes

- 924d48c: schema CLI: `status` now exits non-zero when migrations are pending.

  `runSchemaCli` `status` (and the `kumiko-schema` bin that wraps it) previously
  always exited `0`. It now returns `1` when there are pending migrations and `0`
  when the database is up to date, so `bunx kumiko-schema status` can gate CI
  ("fail the pipeline if the schema drifted from the migrations"). Existing scripts
  that only inspected the printed output are unaffected; scripts that branched on
  the exit code of `status` will now see a non-zero code while migrations are pending.

## 0.24.1

### Patch Changes

- 35d5833: Stop swallowing errors at six review-flagged sites (fail-closed / make visible
  instead of silently dropping).

  - **framework — dispatcher postQuery (single-object result):** a hook that
    returned 0 rows used to fall back to the unhooked original (`rows[0] ?? result`),
    and ≥2 rows silently dropped the extras. A single-object response can only
    carry one row, so this now throws instead of hiding the contract violation.
  - **bundled-features — custom-fields write access-gate:** when a field
    definition row exists but its `serialized_field` is corrupt, the per-field
    `fieldAccess.write` check fell open (`{ ok: true }`) and let the write through
    unvalidated. It now fails closed with `field_definition_corrupt` (secure-by-default).
  - **bundled-features — compliance-profiles override parser:** a corrupt stored
    override is still ignored, but the warning now preserves the parser's failure
    reason instead of flattening it to a generic message.
  - **dev-server — scaffold-deploy:** a malformed `package.json` no longer
    silently skips private-GitHub-package detection; it warns so the
    mis-detection (and a later `yarn install` YN0041) is traceable.

- 6079a87: Complete the `createRegistry` null-guard pass (#98) on seven `feature.*` slot
  accesses the mass-fix missed: `feature.hooks`/`entityHooks` property access,
  the `extensionUsages`/`referenceData`/`configSeeds` spreads, `Object.values`
  over `secretKeys`/`claimKeys`, and the `authClaimsHooks`/`requires` loops now
  all tolerate undefined slots, matching the surrounding `?? {}` / `?? []`
  convention.

  `defineFeature` always populates these fields, so this changes no behaviour for
  features built through the public API — it hardens the hand-built
  `FeatureDefinition` escape hatch (already documented at the `claimKeys` site)
  against `Cannot read properties of undefined` / `TypeError: not iterable`.

- 52cd396: Fix a batch of "wrong-api" issues surfaced in PR review:

  - **`runProdApp` boot-path now reads the injected `envSource`, not the real
    `process.env`.** `requireEnv`/`readEnv`, the `PORT` read, and the
    `KUMIKO_SKIP_ES_OPS` guard all thread the validated env-source (default
    `process.env`), so a caller injecting env (tests / mirrored boot) fully
    controls configuration instead of silently picking up ambient values.
  - **`set-custom-field` embedded validation is now type-shape only.** Embedded
    sub-fields had their `required`/`maxLength`/`format`/`default` constraints
    stripped at the top level but not per sub-field, so a required sub-field
    still rejected missing/empty values — contrary to the documented
    "type-mismatches and ONLY type-mismatches" contract. Embedded values with a
    missing or empty required sub-field are now accepted (the constraint is
    enforced elsewhere, not at set-time), matching the top-level behavior.
  - **`useExtensionSectionComponent(name?)` accepts an optional name**, mirroring
    `useColumnRenderer`, so callers can invoke the hook unconditionally without
    passing a `""` stub.
  - **`kumiko init-deploy` scaffolds into `ctx.cwd`** (not `process.cwd()`) and
    derives the displayed paths via `node:path` `relative(ctx.cwd, …)`, so the
    write target and the printed paths share one root under injected working
    directories.
  - Generated dev-app comment uses the valid `bunx kumiko dev` invocation.

- c5fe2ba: Fix `TypeError: Cannot use valueOf` on create/upsert of any entity whose schema
  declares a field named `source` (or `columns` / `tableName` / `indexes` — any
  `EntityTableMeta` key).

  `table()` spreads the column handles as enumerable props over the
  `EntityTableMeta`, so such a field overwrote the `source: "managed" |
"unmanaged"` discriminator. `extractTableInfo` then failed its meta check and
  fell into the legacy drizzle-introspection branch, which typed timestamptz
  columns via `getSQLType()` as `"timestamp with time zone"` instead of
  `"timestamptz"`. The bun-db serializer only coerces `Temporal.Instant → ISO`
  for `"timestamptz"`, so a raw `Temporal.Instant` reached postgres → the crash,
  on every create of such an entity (e.g. pattern-storage's `pattern-file`, which
  has a `source` field).

  The table builder now stores the canonical meta under a dedicated, unshadowable
  symbol; `extractTableInfo` reads the meta from it and the dead
  drizzle-introspection branch is removed. The two internal call sites that relied
  on the legacy branch — `clearTables`-by-name and a couple of test fixtures — now
  build a real `EntityTableMeta`.

## 0.24.0

### Patch Changes

- c5b7d99: Follow-ups to the `fileRef` event-sourced refactor (#177):

  - **`storage-tracking`**: add a handler for `fileRef.restored` so the
    tenant_storage_usage MSP re-increments after a soft-delete → restore
    round-trip. Without it `totalBytes` / `fileCount` drifted low every
    cycle.
  - **`fileRef` entity**: stop declaring `insertedAt` / `insertedById` as
    entity-fields — they are framework-managed base columns. The field
    variant won the `{...baseCols, ...fieldCols}` merge in
    `buildEntityTable`, dropping `inserted_at`'s `DEFAULT now() NOT NULL`
    and making the column silently nullable.
  - **`DELETE /api/files/:id`**: stop returning `404 not_found` for every
    executor failure. NotFound stays masked at 404; version-conflict /
    ownership / validation / internal surface their real httpStatus
    (409 / 403 / 422 / 500) so callers can distinguish recoverable from
    terminal failure.
  - **`createUserDataRightsDefaultsFeature({ storageProvider })`**: new
    optional option. When provided, the fileRef forget delete-hook calls
    `storageProvider.delete(key)` per row before hard-deleting the row.
    Without it, file binaries leaked dauerhaft on Art. 17 forget — the
    hook logs a one-shot warn so misconfiguration stays visible.

  Also documents what #177 changed without flagging at the time:
  `DELETE /api/files/:id` is now a **soft-delete** (row keeps `is_deleted=
true`, binary stays on disk so restore is possible). Hard erasure of row

  - binary moves to the forget-flow (Art. 17) + data-retention cleanup —
    no files-specific path. Trashed (`is_deleted=true`) files past retention
    still leak their binary; the trashed-files-GC + matching `executor.purge`
    API are tracked as a separate follow-up.

## 0.23.1

### Patch Changes

- 88d492a: `rebuildTablesFromDiff` now only marks `changedTables` with `newColumns.length > 0` for rebuild. Previously every table touched by the diff (even index-only, nullability-only, default-only or drop-only changes) was added to the marker — but those don't need a projection rebuild, the generated `ALTER`/`CREATE INDEX` SQL alone brings the table to the target state. Avoids expensive full-replay (truncate + replay all events) on large streams for changes the SQL already handles.

  `readRebuildMarker` now validates `version === MARKER_VERSION` before reading `tables`, matching the snapshot-loader's contract. A future v2 marker is no longer silently interpreted as v1.

## 0.23.0

### Minor Changes

- 8289134: Unified return-type für alle event-store-Seed-Helper. Alle 5 seed-helpers liefern jetzt `Promise<{ id: ... }>` statt heterogener `string | TenantId | void | { id: string|number }`:

  - `seedTextBlock`, `seedComplianceProfile` — Return-Type von `{ id: string | number }` zu `{ id: string }` (präzise, kein Generic-Inferenz-Verlust)
  - `seedTenant` — Return-Type von `TenantId` zu `{ id: TenantId }`
  - `seedTenantMembership` — Return-Type von `void` zu `{ id: string }` (membership-row-id)
  - `seedUser`, `seedUserWithPassword`, `seedAdmin` — Return-Type von `string` zu `{ id: string }`

  **Breaking:** Caller, die den Return verwenden, müssen destructuren:

  ```ts
  // Vorher
  const userId = await seedUser(db, { email, displayName });

  // Jetzt
  const { id: userId } = await seedUser(db, { email, displayName });
  ```

  Caller, die den Return nicht nutzen (`await seedTenantMembership(...)`), sind unverändert.

  Zusätzlich:

  - `runEventStoreSeed<TId, TExisting>` — Generic-Parameter für die id-Spalte. Default `TId = string` hält die meisten Call-Sites unverändert. `TExisting`-Typ wird aus `existing`-Argument inferred.
  - `TextBlockRow.id` von `string | number` auf `string` präzisiert (text_blocks.id ist uuid).
  - `tenant/seeding.ts` + `user/seeding.ts` Helper-Kommentare präzisieren, dass die Helper add-only-Semantik haben (kein update-Pfad, kein `ifExists`-Knopf — Memberships/Tenant/User ändern läuft über den regulären Handler).
  - Cast-Marker `// @cast-boundary db-row` über den beiden `result.data as ...`-Casts in `compliance-profiles/seeding.ts` und `text-content/seeding.ts` re-added.

### Patch Changes

- e27b7b7: Fix deploy-template drift after the drizzle→`kumiko schema` cutover. Three stale references in the scaffolded `Dockerfile` + `migrate-step.sh` broke every fresh deploy and would have re-broken existing deploys on the next re-scaffold:

  - `Dockerfile.template` copied `/app/dist-server/drizzle.config.ts`, which the single-bundle server build (0.20.0) no longer emits — Docker `COPY` of a missing source fails hard.
  - `Dockerfile.template` copied `/app/drizzle`, but apps on the new schema pipeline (0.21.0) ship `kumiko/migrations/` instead. The COPY broke for apps without a legacy `drizzle/` directory, and even when it succeeded the SQL the runtime needs (`${INIT_CWD}/kumiko/migrations/*.sql`) was missing. Replaced with `COPY /app/kumiko/migrations ./kumiko/migrations`.
  - `Dockerfile.template` set `ENV KUMIKO_MIGRATION_HOOKS=/app/migration-hooks.js`, pointing at a bundle output that 0.20.0 also dropped. The new `schema apply` path doesn't read this env — removed.
  - `migrate-step.sh.template` invoked `bun /app/kumiko.js migrate apply`, but the CLI registers no `migrate` command — only `schema apply`. The pre-deploy migrate step crashed with `Unknown command: migrate`. Fixed to `bun /app/kumiko.js schema apply`.

  Header comments + `KUMIKO_REPO_ROOT`/`INIT_CWD` annotations rewritten to describe the schema-CLI path instead of drizzle-kit. Two new regression tests in `scaffold-deploy.test.ts` lock the migrate command + pin the kumiko/migrations COPY so this drift can't silently return.

  This corrects the "no deploy change" claim in the 0.20.0 changelog entry: 0.20.0 was a deploy-template change, the templates just hadn't been updated.

## 0.22.0

### Minor Changes

- dcc8d4c: `EditSectionSpec` ist jetzt eine Discriminated Union mit `kind?: "fields"` (default, backwards-compat) und `kind: "extension"` (mountet eine feature-bereitgestellte Component). `EditSectionViewModel` parallel als Union (`kind` required). Neue exports: `EditFieldsSection`, `EditExtensionSection`, `EditFieldsSectionViewModel`, `EditExtensionSectionViewModel`, plus Type-Guard `isExtensionEditSection(section)`. Boot-Validator validiert den component-Marker für extension-sections im entityEdit-Block. Bestehende screens (kind weggelassen) rendern unverändert.
- 4156981: Make `fileRef` a standard event-sourced entity. Uploads and deletes now go through the standard entity executor (emitting `fileRef.created` / `fileRef.deleted`, materialised via `applyEntityEvent`) instead of the previous custom `files:event:*` events + bespoke inline projection. `file_refs` is built via `buildEntityTable` (single source of truth) and the entity opts into `softDelete`, so delete / anonymize / retention behaviour now comes from the generic entity lifecycle + `data-retention` + forget pipeline — there is no file-specific retention logic.

  BREAKING: `files:event:uploaded`, `fileUploadedEvent`, `fileUploadedPayloadSchema`, `FileUploadedPayload` and `FILE_UPLOADED_EVENT_TYPE` are removed from `@cosmicdrift/kumiko-framework/files`. Consumers (e.g. multi-stream projections) that subscribed to `files:event:uploaded` must subscribe to the entity auto-verb events `fileRef.created` / `fileRef.deleted` instead. `createFilesFeature` now lives in the framework and is re-exported from `@cosmicdrift/kumiko-bundled-features/files`, so that import path is unchanged.

## 0.21.1

## 0.21.0

### Minor Changes

- c1a044b: Remove the legacy drizzle migration system. Dropped: the drizzle-kit `kumiko migrate` command, the drizzle-journal boot gate (`assertSchemaCurrent` / `detectDrift` / `loadJournal` + schema-drift snapshot helpers), the snapshot-diff projection detection (`compareSnapshots` / `detectProjectionsToRebuild` / `latestMigrationTag` / `projectionsFromChanges`), and the legacy `<tag>__rebuild.json` marker helpers — all from `@cosmicdrift/kumiko-framework/migrations`.

  Use the drizzle-free `kumiko schema` path: `assertKumikoSchemaCurrent` (boot gate), `runMigrationsFromDir` (apply), and the `db` rebuild markers (`readRebuildMarker` / `writeRebuildMarker` / `rebuildTablesFromDiff`). `buildProjectionTableIndex` is retained (moved to its own module, still exported from `/migrations`).

## 0.20.0

### Minor Changes

- 6777250: Server build: bundle all server entries in a single `Bun.build` with code splitting so the framework is emitted once as a shared chunk instead of inlined per entry. `dist-server/` shrinks ~66% (publicstatus ~41 MB → ~14 MB), boot/migrate stay separate entries, no deploy change. Drops the dead drizzle `migration-hooks.js` + `drizzle.config.ts` bundling and the `drizzle-kit`/`drizzle-orm` runtime externals — the migrate path uses `runMigrationsFromDir`.

  Schema migrations: `kumiko schema generate` now writes a `NNNN_<name>.rebuild.json` marker next to each migration listing the changed/new tables, so the apply step can rebuild the affected projections. New helpers `writeRebuildMarker` / `readRebuildMarker` / `rebuildTablesFromDiff` are exported from the `db` entrypoint.

## 0.19.1

### Patch Changes

- a146fc4: Add shared boot-seed contract (`SeedIfExists`, `runEventStoreSeed`) and default skip-if-exists for `seedTextBlock` / `seedComplianceProfile`.

## 0.19.0

### Minor Changes

- 2c84510: migrations: ship an app-facing `kumiko-schema` CLI bin.

  Apps could not run the drizzle-free migration commands: the `kumiko schema`
  subcommands live in the dev CLI, whose registry eager-loads ts-morph-heavy dev
  commands and isn't shipped to apps. This extracts the generate/apply/baseline/
  status core into `@cosmicdrift/kumiko-framework/schema-cli` (`runSchemaCli`) and
  ships a self-contained `kumiko-schema` bin from `@cosmicdrift/kumiko-dev-server`:

      bunx kumiko-schema generate <name>
      bunx kumiko-schema apply
      bunx kumiko-schema baseline   # adopt an existing DB (tables already exist)
      bunx kumiko-schema status

  The dev `kumiko schema` command now delegates to the same core — one
  implementation, no drift.

## 0.18.0

### Minor Changes

- ff49c38: custom-fields: validate set-custom-field values against the fieldDefinition.

  `set-custom-field` now rehydrates the field's `serializedField` into the
  framework's `fieldToZod` schema and validates the incoming value (Builder-Reuse
  / Plan-Doc "Stammfeld-Identität"). Type mismatches return 422 and emit no event,
  so the jsonb projection stays typed. `fieldToZod` is now exported from
  `@cosmicdrift/kumiko-framework/engine`.

  Scope: type-validation only — required-on-set, default-application and the
  searchable-filter remain out of scope.

## 0.17.0

### Minor Changes

- 239e9dc: migrations: drizzle-free boot-gate + repair the `kumiko schema` CLI.

  Phase 1 of the migration-system consolidation (docs/plans/migration-system-consolidation.md):

  - new `assertKumikoSchemaCurrent` / `detectKumikoDrift` boot-gate validates
    `_kumiko_migrations` (applied + checksum) + `kumiko/migrations/.snapshot.json`
    (tables exist), instead of the drizzle journal. `runProdApp` now uses it;
    `options.migrations.dir` default is `./kumiko/migrations`.
  - export the migrate-runner / migrate-generator API from `@cosmicdrift/kumiko-framework/db`
    (`runMigrationsFromDir`, `loadMigrationsFromDir`, `fetchAppliedMigrations`,
    `generateMigration`, `loadSnapshotJson`, …) — the `kumiko schema` CLI imported
    these from the barrel where they were never exported (the command was broken).
  - `kumiko schema status` no longer imports `drizzle-orm`; new `kumiko schema baseline`
    marks checked-in migrations as applied without running their SQL (DB-adoption /
    legacy cutover).

  The legacy drizzle gate (`schema-drift.ts`, `kumiko migrate`) is untouched here and
  removed in Phase 3.

## 0.16.0

### Minor Changes

- 1dcc743: DX-4. Neue Registrar-API `r.unmanagedTable(meta, { reason })`. Features
  mit unmanaged-tables (delivery-attempts, job-run-logs) deklarieren die
  jetzt selbst innerhalb ihrer `defineFeature`-Callbacks — Apps müssen sie
  nicht mehr in `kumiko/schema.ts` manuell pushen.

  `composed.unmanagedTables` aggregiert die metas cross-feature, sodass
  `kumiko schema generate` sie automatisch findet.

  `r.rawTable` (PgTable-basiert, legacy) bleibt unverändert; `r.unmanagedTable`
  ist die EntityTableMeta-Variante (framework-native, post-drizzle).

### Patch Changes

- 9aeabb3: Remove leftover `drizzle-orm` dynamic import from `setupTestStack` projection
  table setup. Use native `extractTableInfo` instead so downstream apps typecheck
  without adding `drizzle-orm` as a devDependency.

## 0.15.0

### Patch Changes

- 5a7f7ac: migrate: detect repos via bunfig.toml, make searchPayloadExtensions optional, TS 6.0 baseUrl fix for samples

## 0.14.0

## 0.13.0

### Minor Changes

- 7f56b2f: **Framework**: add `JsonbFieldDef` + `createJsonbField()` primitive. Schema-less jsonb-Spalte (default `{}`, NOT NULL) für tenant-defined extension-data, AI-inferred metadata, free-form config-blobs. Vs. `embedded` (typed sub-schema): jsonb akzeptiert beliebige keys. Table-builder + schema-builder + e2e-generator alle aktualisiert.

  **custom-fields-Bundle (B2)**: ergänzt B1 um Custom-Field-VALUES:

  - `customField.set` + `customField.cleared` Event-Types (auf host-aggregate stream)
  - `set-custom-field` + `clear-custom-field` write-handlers (emit events)
  - `r.extendsRegistrar("customFields")` für consumer opt-in via `useExtension`
  - `customFieldsField()` helper für entity-fields-definition
  - `wireCustomFieldsFor(r, entityName, entityTable)` consumer-side-API registriert:
    - `r.useExtension("customFields", entity)` opt-in marker
    - MultiStreamProjection: customField.set/.cleared/fieldDefinition.deleted → UPDATE entityTable.customFields jsonb (jsonb_set / minus-operator)
    - `r.entityHook("postQuery", entity, ...)` — flatten row.customFields auf API-root (Spec-Promise "indistinguishable von Stammfeldern")
    - `r.searchPayloadExtension(entity, ...)` — customFields-keys flach ins Meilisearch-Index (F3 wiring)

  **Out-of-B2** (future iterations): cross-scope-conflict (tenant override system fieldKey), cap-counter quota, user-data-rights anonymization, value-validation gegen fieldDefinition.serializedField, system+tenant UNION-read.

  Part of custom-fields-bundle Sprint Phase B2 (Plan-Doc: kumiko-platform/docs/plans/custom-fields-sprint.md).

## 0.12.2

### Patch Changes

- 597de52: `createRegistry` guards all `Object.entries(feature.X)` against undefined slots — bun-bundled features can have optional slots dropped by minification. Pauschal-fix für alle 22 sites in registry.ts (entities, relations, writeHandlers, queryHandlers, configKeys, jobs, notifications, events, translations, searchPayloadExtensions, registrarExtensions, metrics, projections, multiStreamProjections, rawTables, screens, navs, workspaces, handlerEntityMappings, ...).

## 0.12.1

### Patch Changes

- f2ad7c4: `mergeHookList` (the entity-hook variant) also tolerates undefined slots — same fix as `mergeHookListQualified` in 0.11.2 but for the second function. defineFeature leaves `entityHooks.postSave`/`preDelete`/`postDelete`/`postQuery` undefined when not declared; `createRegistry` crashed on `Object.entries(undefined)`.

## 0.12.0

## 0.11.2

### Patch Changes

- 92a84f0: `mergeHookListQualified` tolerates undefined hook-slots.

  `defineFeature` leaves `feature.hooks.preSave`/`postSave`/etc. undefined when no hooks of that type are declared. `createRegistry` called `Object.entries(undefined)` and crashed with `Object.entries requires that input parameter not be null or undefined`.

  Now `mergeHookListQualified` short-circuits on undefined source. Surfaced in studio's production-bundle boot.

## 0.11.1

## 0.11.0

### Minor Changes

- 9347212: Add `r.searchPayloadExtension(entity, fn)` API. Contributor functions add flat fields to an entity's search-index document during `buildSearchDocument` indexing.

  Use-cases:

  - `custom-fields-bundle` (upcoming): merge customFields-jsonb-keys flat into search-doc so tenant-defined fields are searchable
  - Tags-bundle: project tags-array into searchable form
  - Computed-fields: denormalize related-counts (e.g., `messageCount` on conversation)

  Contributor receives `{entityName, entityId, state}`, returns extras to merge. Async-allowed but discouraged (indexing-path hot loop).

  Boot-validation: typo'd entity-names fail-fast at registry-build (sibling to entity-hooks boot-validation).

  **Behavior-change**: entities without any stammfeld `searchable: true` now get a search-doc indexed when at least one extension registers contributors for them. Before this PR, such entities were skipped entirely. This enables custom-fields-only-indexing (the customFields-bundle use-case) but slightly increases Meilisearch-Index-Membership.

  Ownership-tracking: contributors are stored as `OwnedFn` and filtered by `effectiveFeatures` in the getter — feature-toggle-disabled bundles' contributors don't fire (consistent with postQuery-Hooks).

  Part of custom-fields-bundle Sprint Phase F3.

### Patch Changes

- 30ea981: `validateEntityIndexes` allows UNIQUE constraints on single-column `tenantId`.

  Previously any single-column index on `tenantId` was rejected as redundant — `buildDrizzleTable` auto-creates an index on tenantId for query-performance. But that auto-index is **not** a UNIQUE constraint; entities that need a 1:1 relation to the tenant (e.g. `tenant-compliance-profile`) declared `{ unique: true, columns: ["tenantId"] }` explicitly and the validator rejected them, breaking boot.

  Now: `{ unique: true, columns: ["tenantId"] }` passes (semantic UNIQUE constraint, not a duplicate performance-hint). The original block stays in place for `{ unique: false, columns: ["tenantId"] }` (still redundant).

  Surfaced when studio.kumiko.rocks booted in production-bundle and the bundled-features `compliance-profiles` entity hit the validator.

## 0.10.0

### Minor Changes

- 753d392: Add `postQuery` lifecycle-hook. Fires after query-handler-execute, before field-access-read-filter (dispatcher.ts). Supports two registration paths:

  - `r.hook("postQuery", "ns:query:handler", fn)` — handler-keyed, fires only for that specific query-handler
  - `r.entityHook("postQuery", entity, fn)` — entity-keyed, fires for ALL query-handlers of the entity

  Hook receives `{ entityName, rows }` and returns `{ rows }` (possibly modified). Each hook is responsible for its own field-access on values it adds — the built-in field-access-filter only knows the entity's stammfields.

  Use-cases: tags/comments-count/computed-fields/custom-fields-merge. Part of custom-fields-bundle Sprint Phase F1 (see `kumiko-platform/docs/plans/custom-fields-sprint.md`).

### Patch Changes

- d06f029: `validateExtensionUsages` allows self-extension (feature provides AND consumes the same extension).

  Previously a feature like tier-engine — which defines the `tenantTierResolver` extension-point AND ships a default plugin against it — failed boot-validation with `Feature "tier-engine" uses extension "tenantTierResolver" but missing requires("tier-engine")`. `r.requires(self)` would be a circular declaration that the registry-build rejects too, so the only escape was to not validate self-extension. That's now the contract: providerFeature === feature.name short-circuits the dependency check.

  Surfaced when studio.kumiko.rocks booted in production-bundle for the first time (Sprint 9.8). The same source had run for months in monorepo-dev-mode because composeFeatures' bundled-additions happen to come BEFORE the validate step in a different order — only a real `bun build`-bundled boot triggers the path. Memory `feedback_audit_drift_root_cause_now`: framework-bug, not per-app workaround.

## 0.9.0

### Patch Changes

- 51e22f5: Add deploy-template scaffolding (Sprint 9.6).

  **New API:**

  - `scaffoldDeploy({ appName, port?, githubOrg?, destination?, force? })` exported from `@cosmicdrift/kumiko-dev-server`. Generates `deploy/Dockerfile`, `deploy/Dockerfile.dockerignore`, and `deploy/migrate-step.sh` from canonical templates shipped with the package. Substitutes `{{appName}}`, `{{port}}`, `{{githubOrg}}` placeholders.
  - New CLI command: `kumiko init-deploy --app <name> [--port <n>] [--github-org <org>] [--out <dir>] [--force]`.

  The templates are extracted from publicstatus's production-tested `deploy/Dockerfile` (node-alpine build stage → bun-alpine runtime, drizzle migrations baked in, healthcheck wired). Refuses to overwrite existing files unless `--force` is passed so a tuned per-app Dockerfile isn't clobbered.

  **Templates are a starting point, not a contract.** Apps should review and adjust:

  - **Image tag** is hardcoded `:latest` in `migrate-step.sh.template`. Swap to `:${BUILD_SHA}` for atomic deploys.
  - **DB defaults** in `migrate-step.sh.template` assume `db user = db name = appName`, host `db`, port `5432`. Adjust to your stack.
  - **`COPY /app/seeds`** assumes the app uses ES-Operations seed migrations. Comment out if your app has no `seeds/` directory (otherwise `docker build` fails).
  - **`docker build`-smoke-test:** the templates run untested against a non-publicstatus app-tree. Verify locally before pushing to CI.

  **Deferred to Sprint 9.7+:** `.github/workflows/build-image.yml.suggested`, `pulumi/secrets-bootstrap.sh`, `pulumi/extraEnv.snippet.ts`.

  **Plan-Doc drift (for 9.9 update):** Plan-Doc-Tabelle nennt `start.sh` (in-container migrate-then-run); diese Implementation liefert `migrate-step.sh` (host-side deploy-pipeline). Beide Konzepte sind gültig — Plan-Doc-Update sollte das klarstellen.

## 0.8.1

### Patch Changes

- 4b5f91e: Expose `./package.json` via subpath export so downstream tooling (publish/materialize, app-templates) can derive the installed framework version at runtime without manual version-pin drift.

## 0.8.0

### Minor Changes

- f34af9a: Add framework-core env-schema (Sprint 9.2, Migration Phase 1).

  **New API:**

  - `frameworkCoreEnvSchema` exported from `@cosmicdrift/kumiko-dev-server` — Zod-object covering the vars read by framework-core: `PORT` (default `"3000"`), `DATABASE_URL`, `REDIS_URL`, `KUMIKO_INSTANCE_ID`, `KUMIKO_SKIP_ES_OPS`. `DATABASE_URL` + `REDIS_URL` carry `.meta({ kumiko: { pulumi: { secret: true } } })` so `KUMIKO_DRY_RUN_ENV=pulumi` emits `--secret` flags. Plus `FrameworkCoreEnv` type via `z.infer`. `NODE_ENV` is excluded: build-prod-bundle inlines it as a literal at build-time (esbuild define), so runtime env-validation can't observe it.
  - `composeEnvSchema({ core, features, extend, optionalFeatures })` accepts a new `core?` option. Keys from `core` are tagged with source `"framework-core"` in the resulting sources map and in `KumikoBootError.format()` output. Conflict detection runs across core/features/extend — a feature or `extend` block that re-declares a core var throws `KumikoBootError` at compose-time.

  **Why:** Phase 1 of the Sprint 9 env-schema migration (`kumiko-studio/docs/plans/sprint-9-env-schemas.md`). Apps wire `composeEnvSchema({ core: frameworkCoreEnvSchema, features, extend })` into `runProdApp` to get aggregated boot-validation for the vars that framework-core reads. `KUMIKO_DRY_RUN_ENV=pulumi|k8s` then enumerates them with source attribution per row — operators see "(framework-core)" next to `DATABASE_URL` rather than guessing whether the framework or the app is the consumer.

  **Backward-compat:** Purely additive. `runProdApp`'s existing `requireEnv("DATABASE_URL")` / `process.env["KUMIKO_INSTANCE_ID"]` reads remain unchanged. Apps that don't pass `envSchema` behave exactly as before.

  **Feature-specific vars (Phase 2):** `JWT_SECRET` (auth-email-password), `KUMIKO_SECRETS_MASTER_KEY_*` (secrets), `SMTP_*` (channel-email-smtp), `STRIPE_*` / `MOLLIE_*` (subscription-\*) stay scoped to their owning feature's `r.envSchema()` and are NOT in `frameworkCoreEnvSchema`.

- dff4123: Add Zod-based env-schema declarations and boot-time validation (Sprint 9.1).

  **New API:**

  - `r.envSchema(z.object({...}))` — declare per-feature env-vars at registration time.
  - `@cosmicdrift/kumiko-framework/env`: `composeEnvSchema({features, extend, optionalFeatures})` merges feature schemas into one app-wide schema, returning `{schema, sources}`. `parseEnv(schema, env, {sources, pulumiPrefix})` validates `process.env` and throws `KumikoBootError` listing ALL problems at once (aggregated, not first-fail).
  - `@cosmicdrift/kumiko-framework/env/dry-run`: `renderDryRun(composed, mode, opts)` for `human|json|pulumi|k8s` introspection of the required env-vars without booting.
  - `runProdApp({envSchema, pulumiPrefix, bootErrorReporter, envSource})` runs schema validation before any DB/Redis connection. `KUMIKO_DRY_RUN_ENV=1|human|json|pulumi|k8s` prints the inventory and exits.
  - Per-var metadata via Zod's `.meta({ kumiko: { pulumi: { name, generator, secret } } })` for deploy-time tooling overrides.

  **Backward-compat:** Apps without `envSchema` keep working — existing `requireEnv("DATABASE_URL")` calls in `runProdApp` are untouched. Sprint-9.2-9.5 migrates framework + bundled-features + apps to schema-only env handling.

  **Why:** 2026-05-21 Studio deploy stacked 7 hacks chasing missing env-vars (10+ pipeline-fail iterations, ended in rollback). Schema-first boot validation surfaces ALL misconfigs upfront with `pulumi config set …` suggestions, replacing the discover-by-failing loop with a single dry-run + secrets-bootstrap pass.

## 0.7.0

### Minor Changes

- bcf43b6: es-ops: `SeedMembershipRow` exposes `streamTenantId` (stream-tenant aus `kumiko_events.v1`) neben dem payload-`tenantId`. Seed-Authors müssen den `kumiko_events`-JOIN nicht mehr selbst bauen — `m.streamTenantId` ist der korrekte Wert für `systemWriteAs`'s `tenantIdOverride` wenn das Aggregate von einem fremden Executor angelegt wurde (typisches `seedTenantMembership(by=systemAdmin)`-Pattern).

## 0.6.0

### Minor Changes

- 8489d18: feat(es-ops): Phase 1.5 — tenantIdOverride + dry-run-validator + E2E-Test + Doku

  Phase 1.5 schließt die Lücken aus Phase 1 die den ersten Driver-Use-Case
  (publicstatus admin-roles) blockten. Siehe Retro:
  `kumiko-platform/docs/plans/features/es-ops-phase1-retro.md` (PR #9).

  **A1 — tenantIdOverride:**
  `SeedMigrationContext.systemWriteAs(qn, payload, tenantIdOverride?)`.
  Default SYSTEM_TENANT_ID (unverändert für System-scope-Aggregates wie
  config-values). Mit override: `createSystemUser(tenantIdOverride)` als
  Executor, damit der Event-Store-Executor den Aggregate-Stream im
  richtigen Tenant findet. Fix für die `version_conflict`-Klasse-Bug
  (Memory `feedback_event_store_tenant_consistency.md`).

  **A2 — dry-run-validator:**
  Runner parsed seed-files vor `migration.run()` per regex
  `systemWriteAs\(["']([^"']+)["']`, sammelt handler-QNs, validiert
  gegen `registry.getWriteHandler(qn)`. Fail-fast mit klarer Message

  - Datei + QN statt zur Runtime "handler not found". Catched camelCase-
    typos (kebab-case-vs-camelCase Drift) + andere QN-Drift zur Boot-Zeit.
    runProdApp reicht den richtigen Registry rein (`registry` neu in
    RunPendingSeedMigrationsArgs).

  **A3 — E2E-Test:**
  `packages/bundled-features/src/__tests__/es-ops-e2e.integration.ts`
  mit `setupTestStack`-Pattern: tenant+config Features echt geladen,
  echtes Membership-Aggregate via TenantHandlers.addMember im Demo-Tenant,
  seed-migration ruft update-member-roles mit tenantIdOverride → write
  geht durch, Marker landed, Event in Store, Read-Model aktualisiert.
  Plus typo-Test: seed mit camelCase fail-t Dry-Run mit
  `/dry-run found.*unknown handler-QN/`. **TDD-First**: ohne A1+A2 wäre
  der test rot.

  **A4 — Doku:**
  `framework/src/es-ops/README.md` erweitert um „Wann brauche ich
  tenantIdOverride?" + „Deployment-Anforderungen" (Docker COPY, Idempotenz,
  Multi-Replica) + „Lokaler Smoke vor Push". Recipe-README + seed-files
  auf neue API aktualisiert.

  **A5 — Smoke-Skript-Template:**
  `samples/recipes/seed-migration/scripts/smoke.ts` als copy-paste-Template
  für App-Authors: Bun-runnable, offline (read-only, kein DB-Write),
  validiert Module-Load + QN-Resolution + System-User-Access. Recipe-
  README dokumentiert Pflicht-Pattern.

  **Bonus-Fix:**
  `tenant:write:create`-access auf `["system", "SystemAdmin"]` erweitert
  (symmetrisch zu update-member-roles). Aufgedeckt durch Recipe-Smoke +
  initial-tenants-Seed. Pinning-Test in `tenant.integration.ts` updated.

  **Test-State:** 45/45 grün (Pre-Push). Typecheck clean. Biome clean.
  as-cast-Audit clean. Guard-silent-skip clean. Recipe-Smoke clean.

  **Folge-Step (separater PR):** publicstatus driver-sample reaktivieren
  mit lokalem Pre-Push-Smoke gegen publicstatus' echtes Feature-Set.

## 0.5.2

### Patch Changes

- 4f0d781: fix(tenant): updateMemberRoles erlaubt "system"-Rolle (symmetrisch zu create)

  Drift innerhalb des tenant-Features: `tenant:write:create` akzeptierte
  `["system", "SystemAdmin"]`, `tenant:write:update-member-roles` aber
  nur `["SystemAdmin"]`. Konsequenz: ops-tooling und seed-migrations
  (`createSystemUser` mit `roles: ["system"]`) konnten den Handler nicht
  aufrufen — `access_denied`.

  Live entdeckt beim ersten Driver-Sample der es-ops Phase 1: publicstatus
  seed `2026-05-20-fix-admin-roles.ts` rief `update-member-roles` via
  `systemWriteAs` → access_denied → Pod CrashLoopBackOff.

  Plus access-rule-Pinning-Test in `tenant.integration.ts`-scenario-7.

## 0.5.1

### Patch Changes

- 0e00015: fix(es-ops): path.resolve statt path.join für seedsDir → seed-files

  Bun's `await import()` braucht absolute Pfade. Wenn der App-Author
  `runProdApp({ seedsDir: "./seeds" })` setzt (relativ), würde
  `path.join("./seeds", "foo.ts")` einen relativen Pfad liefern → Bun's
  Import-Resolver such relativ zum `runner.ts`-Modul (nicht zum
  `process.cwd()`) → `Cannot find module 'seeds/...' from '<runner-path>'`.

  `path.resolve` löst gegen `process.cwd()` auf → absolute Pfade →
  Import funktioniert. Aufgedeckt beim ersten Live-Boot der publicstatus-
  Driver-Migration (Pod CrashLoopBackOff).

## 0.5.0

### Minor Changes

- 7ff69ab: feat(es-ops): Phase 1 — file-based seed-migrations

  Neues first-class Operations-Pattern fürs Framework. Liefert `seed-migrations`
  als drizzle-migrate-equivalent für Event-Sourcing-Aggregate-Updates die
  idempotent-Seeder nicht erfassen können (z.B. „Member hat schon eine
  Rolle, aber jetzt soll noch eine dazukommen").

  Public-API:

  - `runProdApp({ seedsDir })` — Auto-apply pending Migrations beim Boot
  - `SeedMigration`-Interface (default-Export einer `seeds/<id>.ts`-File)
  - `SeedMigrationContext` mit `systemWriteAs` (ruft existing write-handler
    als System-User) + Read-Helpers (`findUserByEmail`,
    `findMembershipsOfUser`, `findTenants`)
  - CLI: `bunx kumiko ops seed:new|status|apply`
  - Tracking-Table `kumiko_es_operations` mit `operation_type`-Discriminator
    (vorbereitet auf Phase 2+ Operations: projection-rebuild, event-replay,
    stream-migration, ...)
  - Env-Flags: `KUMIKO_SKIP_ES_OPS=1` (alle skippen für Recovery),
    `KUMIKO_SKIP_ES_OPS_<ID>=1` (einzelne kaputte skippen)

  Garantien: single-run via tracking, atomic via per-migration-Tx,
  chronological order via filename-prefix, fail-stop bei Failure (kein
  Partial-Apply), ES-konform via Handler-Dispatch.

  Sub-path-Export: `@cosmicdrift/kumiko-framework/es-ops`

  Plan-Doc: `kumiko-platform/docs/plans/features/es-ops.md`
  Recipe: `samples/recipes/seed-migration/`
  Driver-Use-Case: publicstatus admin-roles-drift (parallel-Branch
  `feat/es-ops-driver-admin-roles`).

  Phase 2+ skizziert + offen markiert — Implementation pro Use-Case.

## 0.4.1

### Patch Changes

- 010b410: feat(auth-email-password): "Bestätigungs-Mail erneut senden" im LoginScreen

  LoginScreen bietet bei reason=email_not_verified jetzt einen Resend-Link
  im Fehler-Banner — der existierende `requestEmailVerification`-Endpoint
  wird direkt aufgerufen, der Banner wechselt nach Erfolg zum Info-Variant
  ("Wir haben dir eine neue Bestätigungs-Mail geschickt.").

  UX-Details:

  - Bei 429 → inline-Hint "Bitte warte kurz und versuche es erneut."
  - Bei Netzwerk/sonstigen Fehlern → inline-Hint "Konnte nicht senden."
  - Anti-Typo-Gate: ändert der User die Email-Eingabe nach dem Login-Fail,
    verschwindet der Resend-Link — sonst würde Resend silent-success an die
    geänderte (potentiell typoed) Adresse gehen ohne User-Feedback.
  - Andere Failure-Codes (invalid_credentials etc.) zeigen weiterhin keinen
    Resend-Link.

  i18n: 4 neue Keys (DE+EN) im `auth.login.resend*`-Namespace, additive.
  Apps die ihre Translations override-en müssen nichts ändern.

  Additive UI-Feature — keine API-Breaks, keine Schema-Migration.

## 0.4.0

### Minor Changes

- 825e7d2: Visual-Tree V.1.4 → V.1.6 — Feature-complete Editor + Folder-Hierarchy + Roving-tabindex.

  **V.1.4** — explicit `folder?: string` Schema-Field auf text-block-entity. Slug bleibt
  kebab-only validiert, Folder explizit gesetzt. Tree gruppiert via `groupBlocksByFolder`
  (ersetzt `groupBlocksBySlugPrefix`). `Subscribe<T>` Signature um optional `emitError`
  erweitert für explicit async-error-Pfade. ProviderBranch zeigt Error-Banner mit
  Retry-Button. Drift-Test pinnt seedTextBlock-vs-set.write Slug-Validation.

  **V.1.4b** — URL-State-Routing für Editor-Target via `nav.searchParams`. F5 + Back-Button
  stellen den Editor-State wieder her. Format: `?t=text-content:edit&a_slug=...&a_lang=...`.
  Plus `useDispatchTarget` hook ersetzt globalen `dispatchTarget` als empfohlenen Production-
  Pfad (legacy bleibt für Test-Hooks).

  **V.1.5** — Arrow-Key-Navigation (`<aside role="tree">`, ARIA-tree-Pattern) + SSE-driven
  Tree-Refresh. `ClientFeatureDefinition.treeEntities?: string[]` listet Entity-Namen pro
  Provider; live-events triggern provider-re-mount → Stale-Tree-state="stub"→"filled"
  flippt nach save automatisch.

  **V.1.5c+d** — Active-Node-Highlight (explicit blue + 2px border-l + scrollIntoView),
  VS-Code-Polish (compact spacing, focus-visible, folder-icon-color text-amber, indent-
  guides per ancestor-depth), Folder-Wrapper für legal-pages ("📁 Legal" + slug-first
  Verschachtelung) und text-content ("📁 Content").

  **V.1.6** — Multi-level Folder-Splitting (`folder="page/marketing"` → nested folders,
  walk-or-create-pattern, folder/leaf-collision-tolerant). Roving-tabindex (nur focused-
  treeitem hat tabIndex=0, Tab cyclt aus dem Tree raus).

  35/35 kumiko check PASS, 13/13 group-blocks + 22/22 text-content integration tests grün.
  Browser + Keyboard lokal validated.

  **Breaking**: `TreeContext` Type entfernt (V.1.2 SR2-Rip — war nie genutzt). Provider sind
  session-bound: `TreeChildrenSubscribe = () => Subscribe<T>` statt `(ctx) => Subscribe<T>`.

  **V.1.7-Followups**: useEffect-deps in VisualTree-focus-init (Performance), Cancellation-
  Token in TreeProvider's fetch (emit-after-unmount-warning), inline-rename, drag-drop,
  file-icons per slug-extension, parent-jump bei ArrowLeft auf collapsed-item.

## 0.3.0

### Minor Changes

- 0.3.0 bringt zwei neue Subsysteme (Step-Engine Tier-3 + Visual-Tree) plus
  eine AST-Codemod-Pipeline als Vorarbeit für den L2-AI-Layer.

  ### Breaking Changes

  - `skipTransitionGuard` → `unsafeSkipTransitionGuard` (Rename in
    feature-ast + engine). Der `unsafe`-Prefix macht die Tragweite des
    Casts sichtbar und ist konsistent zur `unsafeProjectionUpsert`- und
    `r.rawTable`-Konvention. Migration: 1:1-Ersetzung, keine Verhaltens-Änderung.

  ### Features

  - **Step-Engine M.4 — Tier-3 Workflow-Engine.** Neue Step-Vocabulary
    `wait`, `waitForEvent`, `retry` ermöglicht persistierte Long-Running-Flows
    über Job-Boundaries hinweg. Q7 Snapshot-at-Start hängt jedem Step-Run
    einen SHA-256-Fingerprint des Aggregat-Zustands an, sodass Replays
    deterministisch gegen den ursprünglichen Eingangszustand laufen.
  - **Visual-Tree V.1.x — Tree-API + Editor-Panel.** Neue `VisualTree`-
    Component plus TreeProvider-Pattern; erste TreeProviders für
    `text-content` und `legal-pages` (CMS-light + Impressum/Privacy).
    Fundament für den späteren No-Code-Designer (~3000 LOC, 98 Tests).
  - **Codemod-Pipeline.** AST-basierte Patcher-Module für strukturelle
    Feature-Edits — wird vom kommenden L2-AI-Layer als Tool-Surface
    verwendet, ist aber eigenständig nutzbar für ts-morph-style Migrationen.
  - **user-data-rights Sample-Recipe.** DSGVO Art. 15/17/18/20 vollständig
    als Sample-Recipe (`samples/recipes/`) inklusive README — zeigt die
    Export- und Forget-Pipeline gegen den `compliance-profiles`-Default
    (`eu-dsgvo`).

  ### Fixes

  - `tier-engine`: auto-default-tier-Hook benutzt jetzt `ctx.db.raw` für
    Event-Store-Operationen (#37, vorher: stiller Bug, 22 Tage live).
  - `engine`: unsafe-projection-upsert nutzt `as never` statt `as any` —
    schmaler Cast-Surface, weniger Compiler-Knebel.
  - `visual-tree`: runtime-isolation marker für client-konsumierte Files,
    damit der Multi-Entry-Build den richtigen Bundle-Split bekommt.
  - `feature-ast`: vollständiger `unsafeSkipTransitionGuard`-Rename (war
    in zwei Modulen noch der alte Name).
  - `framework`: Error-Reasons + `noConsole`-Lint + No-Date-API-Guard
    wieder push-ready.

  ### Library-Updates

  hono 4.12, jose 6.2, stripe 22.1, meilisearch 0.58, marked 18,
  bun-types 1.3.13, lucide-react 1.14, bullmq 5.76, ioredis 5.10,
  i18next 26.0, react + radix-ui-primitives auf aktuelle Minors.

## 0.2.3

## 0.2.2

### Patch Changes

- 7a7da3e: Re-publish 0.2.1 → 0.2.2 mit korrekt aufgelösten cross-package-Versionen.
  0.2.1 hatte `workspace:*` als Wert in den dependencies (npm publish ohne
  yarn-pack rewrite), Konsumenten bekamen "Workspace not found".

  publish-with-oidc.sh nutzt jetzt `yarn pack` (rewrited workspace:\*) +
  `npm publish <tarball>` (OIDC + provenance).

## 0.2.1

### Patch Changes

- 48b7f6a: CI: switch publish to npm-CLI with OIDC Trusted Publishing + provenance.
  No source changes — verifies the new publish path produces a verified-
  provenance attestation on npmjs.com instead of token-based publish.

## 0.2.0

### Minor Changes

- 6c70b6f: fix(tenant): seedTenant idempotent gegen Event-Store-Projection-Drift.

  Verhindert version_conflict beim App-Boot wenn Aggregat existiert aber
  Projection-Row fehlt (rebuild-drift, async-lag, manueller DB-Eingriff).

## 0.1.0

### Minor Changes

- 59ba6d7: Initial public release of Kumiko — AI-native backend builder.

  What ships in 0.1.0:

  - **Engine** (`@cosmicdrift/kumiko-framework`): `defineFeature`, `r.entity`, `r.writeHandler`, `r.queryHandler`, `r.projection`, `r.multiStreamProjection`, `r.hook`, `r.translations`, `r.crud`, `r.referenceData`, `r.screen`, `r.nav`, `r.authClaims`, full lifecycle pipeline with field-level access checks
  - **Pipeline** (`@cosmicdrift/kumiko-framework`): `createDispatcher`, JWT auth via jose, Zod schema validation, role-based access checks, command/write/query split
  - **DB** (`@cosmicdrift/kumiko-framework`): Drizzle helpers (`buildDrizzleTable`, `applyCursorQuery`), CRUD executor, Postgres dialect, optimistic locking, soft delete, multi-tenant scoping
  - **Event sourcing** (`@cosmicdrift/kumiko-framework`): aggregate streams, single + multi-stream projections, event upcasters, asOf queries, archive support, AsyncDaemon-pattern dispatcher
  - **Bundled features** (`@cosmicdrift/kumiko-bundled-features`): auth-email-password, sessions, tenants, users, jobs, secrets, file-provider-s3, mail-transport-smtp/inmemory, billing-foundation, cap-counter, channel-in-app, delivery, feature-toggles, legal-pages
  - **Renderer** (`@cosmicdrift/kumiko-renderer`, `@cosmicdrift/kumiko-renderer-web`): schema-driven CRUD UI for React + Expo Web, override paths, list debounce, theme tokens
  - **Headless** (`@cosmicdrift/kumiko-headless`): view-models for list/edit screens, locale-aware
  - **Dev server** (`@cosmicdrift/kumiko-dev-server`): `runDevApp`, `runProdApp`, `kumiko-build` for production bundles (client + server), Docker-ready
  - **Realtime** (`@cosmicdrift/kumiko-dispatcher-live`): SSE broadcast across tenants, Redis Pub/Sub backend
  - **CLI** (`bin/kumiko.ts`): interactive dev menu, test runners, check pipeline (Biome + TypeScript + 18 guards + Vitest)

  This is a pre-1.0 release — APIs may change between minor versions. Breaking changes will be documented per release.
