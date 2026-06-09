# @cosmicdrift/kumiko-framework

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
