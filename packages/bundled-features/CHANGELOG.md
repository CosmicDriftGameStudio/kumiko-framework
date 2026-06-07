# @cosmicdrift/kumiko-bundled-features

## 0.31.1

### Patch Changes

- Updated dependencies [6f79d05]
  - @cosmicdrift/kumiko-framework@0.31.1
  - @cosmicdrift/kumiko-renderer@0.31.1
  - @cosmicdrift/kumiko-dispatcher-live@0.31.1
  - @cosmicdrift/kumiko-renderer-web@0.31.1

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

### Patch Changes

- Updated dependencies [b74ddbe]
- Updated dependencies [5b1a594]
  - @cosmicdrift/kumiko-framework@0.31.0
  - @cosmicdrift/kumiko-renderer@0.31.0
  - @cosmicdrift/kumiko-dispatcher-live@0.31.0
  - @cosmicdrift/kumiko-renderer-web@0.31.0

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

### Patch Changes

- Updated dependencies [00020b4]
  - @cosmicdrift/kumiko-framework@0.30.0
  - @cosmicdrift/kumiko-renderer@0.30.0
  - @cosmicdrift/kumiko-dispatcher-live@0.30.0
  - @cosmicdrift/kumiko-renderer-web@0.30.0

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

- 4398d02: tenant: Neuer `tenant:write:enable`-Handler (SystemAdmin) als Recovery-Gegenstück zu disable. `tenant:query:memberships` filtert jetzt Memberships deaktivierter Tenants — disabled Tenants verschwinden damit aus Login-Tenant-Wahl, /auth/tenants (Tenant-Switcher) und switch-tenant.
- 3186d8a: Tenant-Switcher zeigt Tenant-Namen statt UUID-Präfix: `tenant:query:memberships` reichert jede Membership um `tenantName`/`tenantKey` aus der tenants-Projection an, `GET /auth/tenants` reicht beides als `name`/`key` durch (`TenantSummary` erweitert), und der TenantSwitcher rendert `name > key > UUID-Präfix` — die `tenantName`-Prop bleibt als App-Override erhalten. Vorher waren Seed-Tenants (`00000000-…0001/0002`) im Switcher ununterscheidbar.

### Patch Changes

- Updated dependencies [f9d41ae]
- Updated dependencies [290a05b]
- Updated dependencies [3186d8a]
  - @cosmicdrift/kumiko-framework@0.29.0
  - @cosmicdrift/kumiko-renderer@0.29.0
  - @cosmicdrift/kumiko-dispatcher-live@0.29.0
  - @cosmicdrift/kumiko-renderer-web@0.29.0

## 0.28.0

### Minor Changes

- e42fef9: `r.describe(text)` — features declare a one-to-three-sentence docs-lead that flows
  into `FeatureDefinition.description` and the generated feature-manifest. All bundled
  features ship descriptions; the docs feature-reference pages render them as lead
  paragraphs.

### Patch Changes

- 743db9b: extraRoutes-deps liefern jetzt `registry` + `dispatchSystemWrite` (runProdApp + createKumikoServer/runDevApp) — das Wiring, das `createSubscriptionWebhookHandler` für Provider-Webhook-Routen braucht. Dazu: `KumikoServer`/`ApiEntrypoint`/`TestStack` exponieren den Command-Dispatcher, `createSystemUser` nimmt optionale `extraRoles` (kein Access-Bypass für die system-Rolle — Ziel-Handler gaten auf explizite Rollen wie SystemAdmin).
- Updated dependencies [743db9b]
- Updated dependencies [e42fef9]
  - @cosmicdrift/kumiko-framework@0.28.0
  - @cosmicdrift/kumiko-renderer@0.28.0
  - @cosmicdrift/kumiko-dispatcher-live@0.28.0
  - @cosmicdrift/kumiko-renderer-web@0.28.0

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

### Patch Changes

- Updated dependencies [ea365d1]
  - @cosmicdrift/kumiko-framework@0.27.0
  - @cosmicdrift/kumiko-renderer@0.27.0
  - @cosmicdrift/kumiko-dispatcher-live@0.27.0
  - @cosmicdrift/kumiko-renderer-web@0.27.0

## 0.26.0

### Minor Changes

- ed1ce4b: fix(tier-engine): tier-assignment create/update are now SystemAdmin-only (was `TenantAdmin | SystemAdmin`). A tenant admin could previously write their own tier-assignment — a free self-upgrade to a higher plan. Tier changes are a platform/billing concern; reads (list, get-active-tier) stay TenantAdmin-visible, and the auto-default-tier hook + billing both write as system, so neither is affected. **Breaking** only for callers that invoked tier-assignment writes as a plain TenantAdmin — switch them to SystemAdmin.

### Patch Changes

- b539942: fix(foundation-shared): trim whitespace in `requireNonEmpty` — whitespace-only config values are now rejected and surrounding whitespace is stripped, so a stray `" host "` no longer reaches the provider SDK as-is
- Updated dependencies [de348c6]
- Updated dependencies [4911a41]
- Updated dependencies [4e68aff]
  - @cosmicdrift/kumiko-renderer-web@0.26.0
  - @cosmicdrift/kumiko-renderer@0.26.0
  - @cosmicdrift/kumiko-framework@0.26.0
  - @cosmicdrift/kumiko-dispatcher-live@0.26.0

## 0.25.0

### Patch Changes

- Updated dependencies [924d48c]
  - @cosmicdrift/kumiko-framework@0.25.0
  - @cosmicdrift/kumiko-renderer@0.25.0
  - @cosmicdrift/kumiko-dispatcher-live@0.25.0
  - @cosmicdrift/kumiko-renderer-web@0.25.0

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

- b497f4d: Custom-fields: close a cross-tenant write on the set/clear projection. The
  `customField.set`/`.cleared` apply-fns updated the host row by its global
  `aggregateId` UUID only, so a member of tenant A could overwrite or clear tenant
  B's `customFields` by passing B's known row UUID as `entityId`. The projection
  UPDATEs now also filter `tenant_id = event.tenantId` (the same guard the
  fieldDefinition-delete cleanup already uses).

  Also harden the `set-custom-field` payload: `value` (a `z.unknown()`, implicitly
  optional) must be present, so a missing value fails validation instead of
  reaching the projection as `JSON.stringify(undefined)`.

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

- Updated dependencies [35d5833]
- Updated dependencies [6079a87]
- Updated dependencies [52cd396]
- Updated dependencies [c5fe2ba]
  - @cosmicdrift/kumiko-framework@0.24.1
  - @cosmicdrift/kumiko-renderer@0.24.1
  - @cosmicdrift/kumiko-renderer-web@0.24.1
  - @cosmicdrift/kumiko-dispatcher-live@0.24.1

## 0.24.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [c5b7d99]
  - @cosmicdrift/kumiko-framework@0.24.0
  - @cosmicdrift/kumiko-renderer@0.24.0
  - @cosmicdrift/kumiko-dispatcher-live@0.24.0
  - @cosmicdrift/kumiko-renderer-web@0.24.0

## 0.23.1

### Patch Changes

- Updated dependencies [88d492a]
  - @cosmicdrift/kumiko-framework@0.23.1
  - @cosmicdrift/kumiko-renderer@0.23.1
  - @cosmicdrift/kumiko-dispatcher-live@0.23.1
  - @cosmicdrift/kumiko-renderer-web@0.23.1

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

- Updated dependencies [e27b7b7]
- Updated dependencies [8289134]
  - @cosmicdrift/kumiko-framework@0.23.0
  - @cosmicdrift/kumiko-renderer@0.23.0
  - @cosmicdrift/kumiko-dispatcher-live@0.23.0
  - @cosmicdrift/kumiko-renderer-web@0.23.0

## 0.22.0

### Minor Changes

- dcc8d4c: Neues subpath-export `@cosmicdrift/kumiko-bundled-features/custom-fields/web` mit `CustomFieldsFormSection`-Component + `customFieldsClient()`-Factory. Apps mounten die Set-Value-UI via `createKumikoApp({ clientFeatures: [customFieldsClient()] })` und referenzieren sie im Screen-Schema als extension-section: `{ kind: "extension", title, component: { react: { __component: CUSTOM_FIELDS_FORM_EXTENSION_NAME } } }`. Plus `CustomFieldsHandlers` / `CustomFieldsQueries` constants und `CUSTOM_FIELDS_FORM_EXTENSION_NAME`-Konstante für den Schema-Lookup.

  Werte werden heute beim Save sequentiell via `custom-fields:write:set-custom-field` dispatched; Pre-population existierender Werte ist ein Follow-up (braucht erweiterte `ExtensionSectionProps.values`).

- 4156981: Make `fileRef` a standard event-sourced entity. Uploads and deletes now go through the standard entity executor (emitting `fileRef.created` / `fileRef.deleted`, materialised via `applyEntityEvent`) instead of the previous custom `files:event:*` events + bespoke inline projection. `file_refs` is built via `buildEntityTable` (single source of truth) and the entity opts into `softDelete`, so delete / anonymize / retention behaviour now comes from the generic entity lifecycle + `data-retention` + forget pipeline — there is no file-specific retention logic.

  BREAKING: `files:event:uploaded`, `fileUploadedEvent`, `fileUploadedPayloadSchema`, `FileUploadedPayload` and `FILE_UPLOADED_EVENT_TYPE` are removed from `@cosmicdrift/kumiko-framework/files`. Consumers (e.g. multi-stream projections) that subscribed to `files:event:uploaded` must subscribe to the entity auto-verb events `fileRef.created` / `fileRef.deleted` instead. `createFilesFeature` now lives in the framework and is re-exported from `@cosmicdrift/kumiko-bundled-features/files`, so that import path is unchanged.

### Patch Changes

- edebd91: custom-fields: tighten set-custom-field value-validation to pure type-only.

  `buildCustomFieldValueSchema` now strips `required`, `maxLength`, `format`, and
  `default` from the rehydrated `serializedField` before handing it to
  `fieldToZod`, so the runtime schema validates the TYPE-shape only — matching
  the handler's documented scope ("NUR Type-Validation"). Pre-fix `fieldToZod`
  folded these keys into Zod refinements asymmetrically: `text` with
  `required:true` rejected empty strings while `number` constraints in
  `serializedField` were silently ignored.

  The supported-types pre-check (with explicit known sub-types for `embedded`)
  also replaces the catch-all try/catch — unexpected throws from `fieldToZod`
  now propagate as real bugs instead of silently disabling validation.

  Behavior change: empty strings, over-`maxLength` text, and non-email/url
  strings on `text` fields with constraint keys in `serializedField` now pass
  set-custom-field. Use a separate validation layer if you need them rejected
  on set; required-on-set + length/format enforcement remain explicit
  non-goals of the handler (Plan-Doc "Stammfeld-Identität").

- 62bf38b: Fix `files-provider-s3` `writeStream` to trust Bun's S3-Writer for part boundaries instead of manually tracking `buffered` and calling `writer.flush()` at `STREAM_PART_SIZE`. The manual flush could commit a non-final part below the 5 MiB minimum, which AWS S3 and Cloudflare R2 reject with `EntityTooSmall` on `CompleteMultipartUpload` (the integration test runs against MinIO which doesn't enforce the minimum, so the failure mode was invisible there). Adds a multipart `writeStream` round-trip to the integration suite.
- Updated dependencies [dcc8d4c]
- Updated dependencies [dcc8d4c]
- Updated dependencies [4156981]
  - @cosmicdrift/kumiko-framework@0.22.0
  - @cosmicdrift/kumiko-renderer@0.22.0
  - @cosmicdrift/kumiko-renderer-web@0.22.0
  - @cosmicdrift/kumiko-dispatcher-live@0.22.0

## 0.21.1

### Patch Changes

- 0809f08: Replace the AWS SDK S3 client with Bun's native `Bun.S3Client` in the `files-provider-s3` storage provider. Drops the `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, and `@aws-sdk/s3-request-presigner` runtime dependencies. Public API (`createS3Provider`, `createS3ProviderFromEnv`, `resolveForcePathStyle`) is unchanged; multipart streaming, presigned download URLs with content-disposition, and path-style/virtual-host auto-detection are preserved and verified against MinIO.
  - @cosmicdrift/kumiko-framework@0.21.1
  - @cosmicdrift/kumiko-dispatcher-live@0.21.1
  - @cosmicdrift/kumiko-renderer@0.21.1
  - @cosmicdrift/kumiko-renderer-web@0.21.1

## 0.21.0

### Patch Changes

- Updated dependencies [c1a044b]
  - @cosmicdrift/kumiko-framework@0.21.0
  - @cosmicdrift/kumiko-renderer@0.21.0
  - @cosmicdrift/kumiko-dispatcher-live@0.21.0
  - @cosmicdrift/kumiko-renderer-web@0.21.0

## 0.20.0

### Patch Changes

- Updated dependencies [6777250]
  - @cosmicdrift/kumiko-framework@0.20.0
  - @cosmicdrift/kumiko-renderer@0.20.0
  - @cosmicdrift/kumiko-dispatcher-live@0.20.0
  - @cosmicdrift/kumiko-renderer-web@0.20.0

## 0.19.1

### Patch Changes

- a146fc4: Add shared boot-seed contract (`SeedIfExists`, `runEventStoreSeed`) and default skip-if-exists for `seedTextBlock` / `seedComplianceProfile`.
- Updated dependencies [a146fc4]
  - @cosmicdrift/kumiko-framework@0.19.1
  - @cosmicdrift/kumiko-dispatcher-live@0.19.1
  - @cosmicdrift/kumiko-renderer@0.19.1
  - @cosmicdrift/kumiko-renderer-web@0.19.1

## 0.19.0

### Patch Changes

- Updated dependencies [2c84510]
  - @cosmicdrift/kumiko-framework@0.19.0
  - @cosmicdrift/kumiko-renderer@0.19.0
  - @cosmicdrift/kumiko-dispatcher-live@0.19.0
  - @cosmicdrift/kumiko-renderer-web@0.19.0

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

### Patch Changes

- Updated dependencies [ff49c38]
  - @cosmicdrift/kumiko-framework@0.18.0
  - @cosmicdrift/kumiko-renderer@0.18.0
  - @cosmicdrift/kumiko-dispatcher-live@0.18.0
  - @cosmicdrift/kumiko-renderer-web@0.18.0

## 0.17.0

### Patch Changes

- Updated dependencies [239e9dc]
  - @cosmicdrift/kumiko-framework@0.17.0
  - @cosmicdrift/kumiko-renderer@0.17.0
  - @cosmicdrift/kumiko-dispatcher-live@0.17.0
  - @cosmicdrift/kumiko-renderer-web@0.17.0

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

- Updated dependencies [1dcc743]
- Updated dependencies [9aeabb3]
  - @cosmicdrift/kumiko-framework@0.16.0
  - @cosmicdrift/kumiko-renderer@0.16.0
  - @cosmicdrift/kumiko-dispatcher-live@0.16.0
  - @cosmicdrift/kumiko-renderer-web@0.16.0

## 0.15.0

### Minor Changes

- 79d5891: `createFeatureTogglesFeature({ getRuntime })` — `getRuntime` ist jetzt
  optional. Smoke-Apps (`KUMIKO_DRY_RUN_ENV=boot`) wirken die feature
  ohne runtime-stub-cast aus; production-Apps + Tests müssen den accessor
  weiter setzen.

  Internal: set-handler + toggle-cache-sync MSP fail jetzt lazy mit
  einer aktionsfähigen message, falls jemand `getRuntime` weglässt aber
  trotzdem dispatchet. Vorher mussten App-Authors `null as unknown as
GlobalFeatureToggleRuntime`-doublecasts schreiben — Coding-standards
  verbieten das.

### Patch Changes

- 5a7f7ac: migrate: detect repos via bunfig.toml, make searchPayloadExtensions optional, TS 6.0 baseUrl fix for samples
- Updated dependencies [5a7f7ac]
  - @cosmicdrift/kumiko-framework@0.15.0
  - @cosmicdrift/kumiko-renderer@0.15.0
  - @cosmicdrift/kumiko-dispatcher-live@0.15.0
  - @cosmicdrift/kumiko-renderer-web@0.15.0

## 0.14.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.14.0
- @cosmicdrift/kumiko-dispatcher-live@0.14.0
- @cosmicdrift/kumiko-renderer@0.14.0
- @cosmicdrift/kumiko-renderer-web@0.14.0

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

- 9121928: T1 — integration tests for custom-fields bundle. 6 full-stack scenarios via setupTestStack:

  - Define field → set value → query: customField lands flat in entity-response (postQuery hook + MSP)
  - Clear: fieldKey gone from response after clear-custom-field
  - Multiple fields on same entity: all merge flat
  - Entity without customField values: still queryable
  - fieldDefinition-delete cascade: orphan values removed from all entity-rows via MSP
  - Last-Wins on concurrent set: last value wins (unsafeAppendEvent without expectedVersion)

  Plus bugfix: Event-short-name-constants haben jetzt kebab-dashes statt Punkten (toKebab collapsed dots → Registry-Drift bei type-string-templates).

- 72518fa: custom-fields: per-field `fieldAccess.write` enforcement (T1.5b).

  `set-custom-field` and `clear-custom-field` handlers now read `fieldDefinition.serializedField.fieldAccess.write[]` and reject with `unprocessable` + `reason: "field_access_denied"` when the caller's roles do not intersect. Handler-level RBAC (TenantAdmin/Member) keeps applying on top.

  When `fieldAccess.write` is absent or empty, behavior is unchanged — existing consumers stay green without code changes.

  `serializedField` schema gains the optional `fieldAccess: { read?: string[], write?: string[] }` shape (read is reserved for T1.5c).

- 0a00e7b: custom-fields: user-data-rights wiring (T1.5c).

  New `wireCustomFieldsUserDataRightsFor(r, { entityName, entityTable, userIdColumn })` opt-in helper. Registers a second `r.useExtension(EXT_USER_DATA, ...)` for the host entity whose hooks handle the customFields jsonb under DSGVO Art. 15+17+20:

  - **Export**: every row owned by the user contributes its customFields jsonb into the export bundle under `<entity>.customFields`.
  - **Forget anonymize**: sensitive customFields keys (declared via `serializedField.sensitive: true`) are stripped from the jsonb. Non-sensitive keys stay.
  - **Forget delete**: no-op — the host entity's own user-data-rights hook removes the row, jsonb travels with it.

  `serializedField` gains optional `sensitive: boolean` alongside `fieldAccess` (T1.5b).

- aca1443: custom-fields: per-field retention sweep (T1.5d).

  New `runCustomFieldsRetention(opts)` walks one host entity's rows and strips/nulls customField values whose host-row `modified_at` is older than the per-field `retention.keepFor` policy. Strategy `delete` removes the key; `anonymize` sets it to `null`.

  `serializedField` gains optional `retention: { keepFor: string; strategy: "delete" | "anonymize" }`.

  Designed to run alongside (or inside) the data-retention bundle's daily cron. No auto-registration — the consumer chooses the schedule and which host entities to sweep.

- c6cb96c: custom-fields: per-tenant fieldDefinition quota (T1.5e).

  `createCustomFieldsFeature({ fieldDefinitionLimitPerTenant: N })` installs a quota-aware `define-tenant-field` handler. The handler runs a `COUNT(*)` on `read_custom_field_definitions` per tenant before insert and rejects with `unprocessable` + `reason: cap_exceeded` once the limit is reached.

  Cap is per-tenant total (across all entity-names), not per entity-name — the natural unit for tier-pricing.

  Without the option, behavior is unchanged: the singleton feature and its handler retain pre-T1.5e semantics.

### Patch Changes

- 68b8118: custom-fields: typed `eventDef.name` pattern statt Template-Literal-Konstruktion.

  `createCustomFieldsFeature()` returnt jetzt typed `exports` (`setEvent`, `clearedEvent`, `fieldDefinitionDeletedEvent`). Handler + `wireCustomFieldsFor` nutzen `customFieldsFeature.exports.<event>.name` als compile-time literal-typed qualified-string — keine hand-gebauten `${FEATURE}:event:${SHORT}`-Strings mehr.

  Rationale: T1 hat den toKebab-collapse-Bug aufgedeckt (Dots in short-names kollabieren zu Dashes → Registry-Mismatch bei hand-gebauten Strings). Mit dem refactor wird die Drift compile-time-strukturell unmöglich (siehe Memory feedback_event_def_exports_pattern).

  Kein API-Change für consumers: `createCustomFieldsFeature()` bleibt unverändert; zusätzlicher named export `customFieldsFeature` (Singleton) ist additiv.

- 3d5e9ef: `kumiko-schema-check` CLI — Empfehlung 3 aus Sprint-9.8-Retro
  (`luminous-watching-moler.md`). Diff't APP_FEATURES (runtime, aus
  `src/run-config.ts`) gegen FEATURE_IMPORT_REGISTRY (statisch, aus
  `drizzle/generate.ts`). Fängt Studio's 9.8-Drama: registry 18 features
  hinter APP_FEATURES → migrations fehlten für mounted features.

  Usage (im app-workspace):

  ```sh
  bunx kumiko-schema-check
  # or with custom paths:
  bunx kumiko-schema-check --run-config src/run-config.ts --generate drizzle/generate.ts
  ```

  Plus: 5 bundled-features hatten camelCase feature-names statt kebab-case
  (Memory `feedback_kebab_aggregates`) — aufgedeckt durch den schema-check
  gegen use-all-bundled. Fix: `channelEmail` → `channel-email`,
  `channelInApp` → `channel-in-app`, `channelPush` → `channel-push`,
  `rateLimiting` → `rate-limiting`, `rendererSimple` → `renderer-simple`.

  Plus `CHANNEL_IN_APP_FEATURE` und `RATE_LIMITING_FEATURE` Konstanten
  angepasst (waren intern auf camelCase, jetzt kebab-case).

- Updated dependencies [7f56b2f]
  - @cosmicdrift/kumiko-framework@0.13.0
  - @cosmicdrift/kumiko-renderer@0.13.0
  - @cosmicdrift/kumiko-dispatcher-live@0.13.0
  - @cosmicdrift/kumiko-renderer-web@0.13.0

## 0.12.2

### Patch Changes

- Updated dependencies [597de52]
  - @cosmicdrift/kumiko-framework@0.12.2
  - @cosmicdrift/kumiko-renderer@0.12.2
  - @cosmicdrift/kumiko-dispatcher-live@0.12.2
  - @cosmicdrift/kumiko-renderer-web@0.12.2

## 0.12.1

### Patch Changes

- Updated dependencies [f2ad7c4]
  - @cosmicdrift/kumiko-framework@0.12.1
  - @cosmicdrift/kumiko-renderer@0.12.1
  - @cosmicdrift/kumiko-dispatcher-live@0.12.1
  - @cosmicdrift/kumiko-renderer-web@0.12.1

## 0.12.0

### Minor Changes

- 0c1ebe5: Add `@cosmicdrift/kumiko-bundled-features/custom-fields` — B1 phase of the custom-fields-bundle Sprint.

  **Contents:**

  - `fieldDefinition` entity (event-sourced) — stores tenant-scoped and system-scoped (`tenantId = SYSTEM_TENANT_ID`) custom-field definitions side-by-side
  - 4 write-handlers: `define-tenant-field` (TenantAdmin), `define-system-field` (SystemAdmin), `delete-tenant-field`, `delete-system-field`
  - 1 query-handler: list (tenant-scoped; B2 will add system+tenant UNION resolution)
  - Deterministic aggregate-id from `(tenantId, entityName, fieldKey)` — same-scope conflicts surface naturally as `version_conflict`
  - Builder-Reuse-ready: `serializedField` jsonb stores the dehydrated field-builder-options; B2 will rehydrate for value-validation against `customField.set` events

  **Not in B1 (deferred to B2):**

  - Event-types `customField.set` / `customField.cleared`
  - MSP for value-projection in `read_<entity>.customFields` jsonb
  - Schema-Migration trigger for jsonb-column on host-entities
  - `r.extendsRegistrar("customFields", ...)` + onRegister wiring
  - F1 postQuery + F3 search-payload-extension integration
  - Cross-scope-conflict (tenant trying to override system fieldKey)
  - user-data-rights anonymization wiring
  - cap-counter quota wiring on define
  - In-place type-change-lock (DELETE+CREATE workaround for v1)

  Part of custom-fields-bundle Sprint Phase B1.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.12.0
- @cosmicdrift/kumiko-dispatcher-live@0.12.0
- @cosmicdrift/kumiko-renderer@0.12.0
- @cosmicdrift/kumiko-renderer-web@0.12.0

## 0.11.2

### Patch Changes

- Updated dependencies [92a84f0]
  - @cosmicdrift/kumiko-framework@0.11.2
  - @cosmicdrift/kumiko-renderer@0.11.2
  - @cosmicdrift/kumiko-dispatcher-live@0.11.2
  - @cosmicdrift/kumiko-renderer-web@0.11.2

## 0.11.1

### Patch Changes

- e6f702f: `user-data-rights` declares `r.requires("sessions")` for the `sessions.revokeAllForUser` API it uses.

  The feature called `r.usesApi("sessions.revokeAllForUser")` but didn't list `sessions` in `r.requires(...)`. The framework's `validateApiExposureMatching` boot-check rejects that as inconsistent (any feature exposed by another must be in requires/optionalRequires). Surfaced in studio's production-bundle boot.

  - @cosmicdrift/kumiko-framework@0.11.1
  - @cosmicdrift/kumiko-dispatcher-live@0.11.1
  - @cosmicdrift/kumiko-renderer@0.11.1
  - @cosmicdrift/kumiko-renderer-web@0.11.1

## 0.11.0

### Patch Changes

- Updated dependencies [30ea981]
- Updated dependencies [9347212]
  - @cosmicdrift/kumiko-framework@0.11.0
  - @cosmicdrift/kumiko-renderer@0.11.0
  - @cosmicdrift/kumiko-dispatcher-live@0.11.0
  - @cosmicdrift/kumiko-renderer-web@0.11.0

## 0.10.0

### Patch Changes

- Updated dependencies [d06f029]
- Updated dependencies [753d392]
  - @cosmicdrift/kumiko-framework@0.10.0
  - @cosmicdrift/kumiko-renderer@0.10.0
  - @cosmicdrift/kumiko-dispatcher-live@0.10.0
  - @cosmicdrift/kumiko-renderer-web@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [51e22f5]
  - @cosmicdrift/kumiko-framework@0.9.0
  - @cosmicdrift/kumiko-renderer@0.9.0
  - @cosmicdrift/kumiko-dispatcher-live@0.9.0
  - @cosmicdrift/kumiko-renderer-web@0.9.0

## 0.8.1

### Patch Changes

- Updated dependencies [4b5f91e]
  - @cosmicdrift/kumiko-framework@0.8.1
  - @cosmicdrift/kumiko-renderer@0.8.1
  - @cosmicdrift/kumiko-dispatcher-live@0.8.1
  - @cosmicdrift/kumiko-renderer-web@0.8.1

## 0.8.0

### Minor Changes

- 145b8df: Add env-var contracts for four bundled-features (Sprint 9.3, Migration Phase 2).

  **New API:**

  - `secretsEnvSchema` — `KUMIKO_SECRETS_MASTER_KEY_V1` (base64-32 KEK, refined for length) + `KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION` (default `"1"`).
  - `authEmailPasswordEnvSchema` — `JWT_SECRET` (≥32 chars) + `JWT_ISSUER` (optional).
  - `subscriptionStripeEnvSchema` — `STRIPE_WEBHOOK_SECRET` + `STRIPE_API_KEY` (both non-empty, both `pulumi.secret=true`).
  - `subscriptionMollieEnvSchema` — `MOLLIE_API_KEY` (`test_` or `live_` prefix, `pulumi.secret=true`).

  Each schema is exported from its feature's barrel and attached via `r.envSchema(...)` at feature-mount-time. Apps that mount these features via `composeEnvSchema({ features, ... })` get aggregated boot-validation for the relevant env-vars with source-attribution (`(auth-email-password)`, `(secrets)`, `(subscription-stripe)`, `(subscription-mollie)`).

  **Plan-Doc-Drift dokumentiert:** `mail-transport-smtp` bekommt KEIN envSchema. SMTP_HOST/PORT/SECURE/FROM/AUTH-USER sind tenant-config, SMTP_PASSWORD ist tenant-secret via `r.secret()` — keine process.env-Vars im Feature. Apps die SMTP_HOST etc. aus env seeden, deklarieren das in ihrem `extend`-block.

  **Kumiko-Pattern:** Das schema ist Contract, nicht Doku. Wenn eine App die var anders nennt (z.B. `MY_JWT` statt `JWT_SECRET`), ist sie off-pattern — `composeEnvSchema` würde sie unter dem standardisierten Namen erwarten.

  **Backward-compat:** Purely additive. Apps ohne `composeEnvSchema({features})` behavior unverändert.

### Patch Changes

- Updated dependencies [f34af9a]
- Updated dependencies [dff4123]
  - @cosmicdrift/kumiko-framework@0.8.0
  - @cosmicdrift/kumiko-renderer@0.8.0
  - @cosmicdrift/kumiko-dispatcher-live@0.8.0
  - @cosmicdrift/kumiko-renderer-web@0.8.0

## 0.7.0

### Minor Changes

- bcf43b6: es-ops: `SeedMembershipRow` exposes `streamTenantId` (stream-tenant aus `kumiko_events.v1`) neben dem payload-`tenantId`. Seed-Authors müssen den `kumiko_events`-JOIN nicht mehr selbst bauen — `m.streamTenantId` ist der korrekte Wert für `systemWriteAs`'s `tenantIdOverride` wenn das Aggregate von einem fremden Executor angelegt wurde (typisches `seedTenantMembership(by=systemAdmin)`-Pattern).

### Patch Changes

- Updated dependencies [bcf43b6]
  - @cosmicdrift/kumiko-framework@0.7.0
  - @cosmicdrift/kumiko-dispatcher-live@0.7.0
  - @cosmicdrift/kumiko-renderer@0.7.0
  - @cosmicdrift/kumiko-renderer-web@0.7.0

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

### Patch Changes

- Updated dependencies [8489d18]
  - @cosmicdrift/kumiko-framework@0.6.0
  - @cosmicdrift/kumiko-dispatcher-live@0.6.0
  - @cosmicdrift/kumiko-renderer@0.6.0
  - @cosmicdrift/kumiko-renderer-web@0.6.0

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

- Updated dependencies [4f0d781]
  - @cosmicdrift/kumiko-framework@0.5.2
  - @cosmicdrift/kumiko-dispatcher-live@0.5.2
  - @cosmicdrift/kumiko-renderer@0.5.2
  - @cosmicdrift/kumiko-renderer-web@0.5.2

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

- Updated dependencies [0e00015]
  - @cosmicdrift/kumiko-framework@0.5.1
  - @cosmicdrift/kumiko-dispatcher-live@0.5.1
  - @cosmicdrift/kumiko-renderer@0.5.1
  - @cosmicdrift/kumiko-renderer-web@0.5.1

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

### Patch Changes

- Updated dependencies [7ff69ab]
  - @cosmicdrift/kumiko-framework@0.5.0
  - @cosmicdrift/kumiko-dispatcher-live@0.5.0
  - @cosmicdrift/kumiko-renderer@0.5.0
  - @cosmicdrift/kumiko-renderer-web@0.5.0

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

- Updated dependencies [010b410]
  - @cosmicdrift/kumiko-framework@0.4.1
  - @cosmicdrift/kumiko-dispatcher-live@0.4.1
  - @cosmicdrift/kumiko-renderer@0.4.1
  - @cosmicdrift/kumiko-renderer-web@0.4.1

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

### Patch Changes

- Updated dependencies [825e7d2]
  - @cosmicdrift/kumiko-framework@0.4.0
  - @cosmicdrift/kumiko-dispatcher-live@0.4.0
  - @cosmicdrift/kumiko-renderer@0.4.0
  - @cosmicdrift/kumiko-renderer-web@0.4.0

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

### Patch Changes

- Updated dependencies
  - @cosmicdrift/kumiko-framework@0.3.0
  - @cosmicdrift/kumiko-dispatcher-live@0.3.0
  - @cosmicdrift/kumiko-renderer@0.3.0
  - @cosmicdrift/kumiko-renderer-web@0.3.0

## 0.2.3

### Patch Changes

- 1dbd038: Fix `db.execute is not a function` crash in `createTierEngineFeature`'s
  auto-default-tier postSave-hook when called via the dispatcher path
  (`tenant:write:create`). The hook used `ctx.db as DbConnection` — a
  type-lie. AppContext.db in the inTransaction-phase is a TenantDb, which
  exposes select/insert/update/delete but not execute(). The event-store-
  append (event-store.ts:102) calls `db.execute(sql\`SELECT pg_notify(...)\`)`,
  which crashed at runtime.

  Fix: typeguard via `if (!("raw" in ctx.db)) return` then use `ctx.db.raw
as DbConnection` (pattern matched signup-confirm.write.ts:107).

  Plus: regression integration-test in `tier-engine/__tests__/auto-default-
tier.integration.ts` covering the dispatcher path (sysadmin →
  tenant:write:create → tier_assignments-row + idempotency on tenant-update).

  **Known production gap (separate from this fix):** Self-Signup goes through
  `provisionSignupAccount → seedTenant` (event-store-direct), which bypasses
  the dispatcher → postSave-hooks never fire in production self-signup. This
  fix makes the dispatcher path coherent. Real-signup auto-default needs
  follow-up work (either seedTenant fires hooks or signup-confirm calls
  explicit seed-helpers).

  - @cosmicdrift/kumiko-framework@0.2.3
  - @cosmicdrift/kumiko-dispatcher-live@0.2.3
  - @cosmicdrift/kumiko-renderer@0.2.3
  - @cosmicdrift/kumiko-renderer-web@0.2.3

## 0.2.2

### Patch Changes

- 7a7da3e: Re-publish 0.2.1 → 0.2.2 mit korrekt aufgelösten cross-package-Versionen.
  0.2.1 hatte `workspace:*` als Wert in den dependencies (npm publish ohne
  yarn-pack rewrite), Konsumenten bekamen "Workspace not found".

  publish-with-oidc.sh nutzt jetzt `yarn pack` (rewrited workspace:\*) +
  `npm publish <tarball>` (OIDC + provenance).

- Updated dependencies [7a7da3e]
  - @cosmicdrift/kumiko-framework@0.2.2
  - @cosmicdrift/kumiko-dispatcher-live@0.2.2
  - @cosmicdrift/kumiko-renderer@0.2.2
  - @cosmicdrift/kumiko-renderer-web@0.2.2

## 0.2.1

### Patch Changes

- 48b7f6a: CI: switch publish to npm-CLI with OIDC Trusted Publishing + provenance.
  No source changes — verifies the new publish path produces a verified-
  provenance attestation on npmjs.com instead of token-based publish.
- Updated dependencies [48b7f6a]
  - @cosmicdrift/kumiko-framework@0.2.1
  - @cosmicdrift/kumiko-dispatcher-live@0.2.1
  - @cosmicdrift/kumiko-renderer@0.2.1
  - @cosmicdrift/kumiko-renderer-web@0.2.1

## 0.2.0

### Minor Changes

- 6c70b6f: fix(tenant): seedTenant idempotent gegen Event-Store-Projection-Drift.

  Verhindert version_conflict beim App-Boot wenn Aggregat existiert aber
  Projection-Row fehlt (rebuild-drift, async-lag, manueller DB-Eingriff).

### Patch Changes

- Updated dependencies [6c70b6f]
  - @cosmicdrift/kumiko-framework@0.2.0
  - @cosmicdrift/kumiko-dispatcher-live@0.2.0
  - @cosmicdrift/kumiko-renderer@0.2.0
  - @cosmicdrift/kumiko-renderer-web@0.2.0

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

### Patch Changes

- Updated dependencies [59ba6d7]
  - @cosmicdrift/kumiko-framework@0.1.0
  - @cosmicdrift/kumiko-dispatcher-live@0.1.0
  - @cosmicdrift/kumiko-renderer@0.1.0
  - @cosmicdrift/kumiko-renderer-web@0.1.0
