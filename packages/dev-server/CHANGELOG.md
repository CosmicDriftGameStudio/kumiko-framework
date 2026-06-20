# @cosmicdrift/kumiko-dev-server

## 0.62.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.62.0
- @cosmicdrift/kumiko-framework@0.62.0

## 0.61.0

### Patch Changes

- Updated dependencies [6b624d5]
  - @cosmicdrift/kumiko-bundled-features@0.61.0
  - @cosmicdrift/kumiko-framework@0.61.0

## 0.60.4

### Patch Changes

- Updated dependencies [7f55219]
  - @cosmicdrift/kumiko-framework@0.60.4
  - @cosmicdrift/kumiko-bundled-features@0.60.4

## 0.60.3

### Patch Changes

- Updated dependencies [af1b957]
  - @cosmicdrift/kumiko-framework@0.60.3
  - @cosmicdrift/kumiko-bundled-features@0.60.3

## 0.60.2

### Patch Changes

- Updated dependencies [68c5fee]
  - @cosmicdrift/kumiko-framework@0.60.2
  - @cosmicdrift/kumiko-bundled-features@0.60.2

## 0.60.1

### Patch Changes

- Updated dependencies [bde2443]
  - @cosmicdrift/kumiko-framework@0.60.1
  - @cosmicdrift/kumiko-bundled-features@0.60.1

## 0.60.0

### Patch Changes

- Updated dependencies [95a4a6c]
- Updated dependencies [9ae7ab8]
- Updated dependencies [16e1457]
- Updated dependencies [22c1ba2]
- Updated dependencies [34cb6e7]
- Updated dependencies [141d29b]
- Updated dependencies [fec57ca]
  - @cosmicdrift/kumiko-framework@0.60.0
  - @cosmicdrift/kumiko-bundled-features@0.60.0

## 0.59.2

### Patch Changes

- Updated dependencies [c6018f4]
- Updated dependencies [d57b42f]
- Updated dependencies [fe4dd50]
- Updated dependencies [29aae4d]
- Updated dependencies [6c7262f]
- Updated dependencies [a6c5bf5]
- Updated dependencies [f7e9666]
  - @cosmicdrift/kumiko-framework@0.59.2
  - @cosmicdrift/kumiko-bundled-features@0.59.2

## 0.59.1

### Patch Changes

- Updated dependencies [e8dacba]
- Updated dependencies [99b8220]
- Updated dependencies [31d2d99]
- Updated dependencies [103c5f5]
- Updated dependencies [8a55f62]
  - @cosmicdrift/kumiko-bundled-features@0.59.1
  - @cosmicdrift/kumiko-framework@0.59.1

## 0.59.0

### Patch Changes

- Updated dependencies [6ea62ca]
  - @cosmicdrift/kumiko-bundled-features@0.59.0
  - @cosmicdrift/kumiko-framework@0.59.0

## 0.58.0

### Patch Changes

- Updated dependencies [9733ddc]
- Updated dependencies [9733ddc]
- Updated dependencies [b02c52e]
- Updated dependencies [0202d38]
- Updated dependencies [a3dcb2c]
- Updated dependencies [625a4e2]
- Updated dependencies [f9897cd]
  - @cosmicdrift/kumiko-bundled-features@0.58.0
  - @cosmicdrift/kumiko-framework@0.58.0

## 0.57.2

### Patch Changes

- Updated dependencies [ea2d54d]
- Updated dependencies [99d4489]
  - @cosmicdrift/kumiko-bundled-features@0.57.2
  - @cosmicdrift/kumiko-framework@0.57.2

## 0.57.1

### Patch Changes

- Updated dependencies [d07ef3f]
  - @cosmicdrift/kumiko-framework@0.57.1
  - @cosmicdrift/kumiko-bundled-features@0.57.1

## 0.57.0

### Patch Changes

- Updated dependencies [2e78232]
  - @cosmicdrift/kumiko-framework@0.57.0
  - @cosmicdrift/kumiko-bundled-features@0.57.0

## 0.56.1

### Patch Changes

- Updated dependencies [a72f3a1]
  - @cosmicdrift/kumiko-bundled-features@0.56.1
  - @cosmicdrift/kumiko-framework@0.56.1

## 0.56.0

### Patch Changes

- Updated dependencies [c9a0ef8]
  - @cosmicdrift/kumiko-framework@0.56.0
  - @cosmicdrift/kumiko-bundled-features@0.56.0

## 0.55.1

### Patch Changes

- Updated dependencies [8ccc145]
  - @cosmicdrift/kumiko-bundled-features@0.55.1
  - @cosmicdrift/kumiko-framework@0.55.1

## 0.55.0

### Patch Changes

- Updated dependencies [17fa9ee]
  - @cosmicdrift/kumiko-framework@0.55.0
  - @cosmicdrift/kumiko-bundled-features@0.55.0

## 0.54.0

### Patch Changes

- Updated dependencies [a565b61]
- Updated dependencies [e7a7809]
- Updated dependencies [b2e3a56]
- Updated dependencies [1135437]
  - @cosmicdrift/kumiko-framework@0.54.0
  - @cosmicdrift/kumiko-bundled-features@0.54.0

## 0.53.0

### Minor Changes

- effc862: run-prod-app / run-dev-app: forward `allowedOrigins` + `unsafeSkipOriginCheck` to buildServer

  `RunProdAppAuthOptions` / `RunDevAppAuthOptions` exposed `cookieDomain` but not
  `allowedOrigins` (or `unsafeSkipOriginCheck`), while the buildServer Origin guard
  (#340) **fails closed** when `cookieDomain` is set without an allowlist. An app
  that widened its session cookie across subdomains therefore could not satisfy the
  guard through `runProdApp`/`runDevApp` — it could only CrashLoop on boot.

  Both fields are now part of the auth options and forwarded into the buildServer
  auth config alongside `cookieDomain`. Proven by a boot test: `cookieDomain` alone
  fails closed through `runProdApp`; `cookieDomain` + `allowedOrigins` clears the
  guard (the allowlist reaches buildServer).

### Patch Changes

- @cosmicdrift/kumiko-framework@0.53.0
- @cosmicdrift/kumiko-bundled-features@0.53.0

## 0.52.0

### Patch Changes

- Updated dependencies [c014f18]
  - @cosmicdrift/kumiko-bundled-features@0.52.0
  - @cosmicdrift/kumiko-framework@0.52.0

## 0.51.0

### Patch Changes

- Updated dependencies [ac282fb]
- Updated dependencies [f51c8a8]
- Updated dependencies [f51c8a8]
- Updated dependencies [b40187f]
  - @cosmicdrift/kumiko-framework@0.51.0
  - @cosmicdrift/kumiko-bundled-features@0.51.0

## 0.50.0

### Patch Changes

- 0d92100: dev/prod-parity: validateBoot in dev-server + standalone-stable renderer-web @source + CSS-completeness guard (#359)

  Two prod-only breakages closed, both caused by the dev path validating/building
  differently than the prod path:

  - **Boot-validation parity**: `runDevApp` now runs the same `validateBoot` as
    `runProdApp`, before the fs-watcher and server start. Unqualified nav-/handler
    QNs, unresolvable navigate-targets and screen-access errors now fail fast in
    dev instead of only crashing the prod pod (CrashLoopBackOff).
  - **renderer-web stylesheet scans its own shell standalone**: `renderer-web/src/styles.css`
    scanned its shell classes via a monorepo-relative `@source` (`../../renderer-web/src`),
    which only resolves through the workspace symlink. A standalone consumer install
    found nothing → unstyled prod (15KB vs 48KB). It is now self-relative (`./`),
    which resolves in every install layout since the package ships `src`. Behaviour
    in the monorepo is identical (`./` ≡ the old path at the real location).
  - **Build-time CSS-completeness guard**: when `kumiko-build` falls back to the
    packaged renderer-web stylesheet, it now asserts the compiled CSS contains the
    shell sentinel class and fails loud (with a `src/styles.css` hint) instead of
    shipping an unstyled image.

- Updated dependencies [f06e33a]
- Updated dependencies [d8330bc]
- Updated dependencies [8ca4a27]
- Updated dependencies [d8083ae]
- Updated dependencies [eabad73]
- Updated dependencies [6b16dd9]
- Updated dependencies [c5610ea]
  - @cosmicdrift/kumiko-framework@0.50.0
  - @cosmicdrift/kumiko-bundled-features@0.50.0

## 0.49.0

### Patch Changes

- Updated dependencies [5d8b8ca]
- Updated dependencies [5ffbc19]
  - @cosmicdrift/kumiko-framework@0.49.0
  - @cosmicdrift/kumiko-bundled-features@0.49.0

## 0.48.1

### Patch Changes

- Updated dependencies [ec22610]
- Updated dependencies [b8207de]
  - @cosmicdrift/kumiko-framework@0.48.1
  - @cosmicdrift/kumiko-bundled-features@0.48.1

## 0.48.0

### Patch Changes

- Updated dependencies [2852197]
  - @cosmicdrift/kumiko-framework@0.48.0
  - @cosmicdrift/kumiko-bundled-features@0.48.0

## 0.47.0

### Patch Changes

- Updated dependencies [f32f99d]
  - @cosmicdrift/kumiko-bundled-features@0.47.0
  - @cosmicdrift/kumiko-framework@0.47.0

## 0.46.0

### Patch Changes

- Updated dependencies [7751b71]
  - @cosmicdrift/kumiko-framework@0.46.0
  - @cosmicdrift/kumiko-bundled-features@0.46.0

## 0.45.1

### Patch Changes

- Updated dependencies [3053ef8]
  - @cosmicdrift/kumiko-framework@0.45.1
  - @cosmicdrift/kumiko-bundled-features@0.45.1

## 0.45.0

### Patch Changes

- Updated dependencies [2764993]
  - @cosmicdrift/kumiko-bundled-features@0.45.0
  - @cosmicdrift/kumiko-framework@0.45.0

## 0.44.0

### Patch Changes

- Updated dependencies [b082294]
  - @cosmicdrift/kumiko-framework@0.44.0
  - @cosmicdrift/kumiko-bundled-features@0.44.0

## 0.43.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.43.0
- @cosmicdrift/kumiko-framework@0.43.0

## 0.42.0

### Patch Changes

- Updated dependencies [81ac289]
  - @cosmicdrift/kumiko-bundled-features@0.42.0
  - @cosmicdrift/kumiko-framework@0.42.0

## 0.41.1

### Patch Changes

- Updated dependencies [1e7a66e]
  - @cosmicdrift/kumiko-framework@0.41.1
  - @cosmicdrift/kumiko-bundled-features@0.41.1

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

### Patch Changes

- Updated dependencies [3f2d6ee]
  - @cosmicdrift/kumiko-framework@0.41.0
  - @cosmicdrift/kumiko-bundled-features@0.41.0

## 0.40.1

### Patch Changes

- Updated dependencies [667c79b]
  - @cosmicdrift/kumiko-framework@0.40.1
  - @cosmicdrift/kumiko-bundled-features@0.40.1

## 0.40.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [d10ef7e]
- Updated dependencies [64a51ac]
  - @cosmicdrift/kumiko-framework@0.40.0
  - @cosmicdrift/kumiko-bundled-features@0.40.0

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

### Patch Changes

- Updated dependencies [34cb1f7]
- Updated dependencies [12e1137]
  - @cosmicdrift/kumiko-framework@0.39.0
  - @cosmicdrift/kumiko-bundled-features@0.39.0

## 0.38.0

### Patch Changes

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

- Updated dependencies [8becbed]
- Updated dependencies [0f093f1]
- Updated dependencies [ffcce8a]
- Updated dependencies [7a00d80]
  - @cosmicdrift/kumiko-framework@0.38.0
  - @cosmicdrift/kumiko-bundled-features@0.38.0

## 0.37.0

### Patch Changes

- Updated dependencies
  - @cosmicdrift/kumiko-bundled-features@0.37.0
  - @cosmicdrift/kumiko-framework@0.37.0

## 0.36.0

### Patch Changes

- Updated dependencies [d84a515]
  - @cosmicdrift/kumiko-framework@0.36.0
  - @cosmicdrift/kumiko-bundled-features@0.36.0

## 0.35.0

### Patch Changes

- Updated dependencies [6553405]
  - @cosmicdrift/kumiko-framework@0.35.0
  - @cosmicdrift/kumiko-bundled-features@0.35.0

## 0.34.2

### Patch Changes

- Updated dependencies [ce4a16f]
  - @cosmicdrift/kumiko-bundled-features@0.34.2
  - @cosmicdrift/kumiko-framework@0.34.2

## 0.34.1

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.34.1
- @cosmicdrift/kumiko-framework@0.34.1

## 0.34.0

### Patch Changes

- Updated dependencies [9be544f]
  - @cosmicdrift/kumiko-framework@0.34.0
  - @cosmicdrift/kumiko-bundled-features@0.34.0

## 0.33.0

### Patch Changes

- Updated dependencies [0bb1b92]
  - @cosmicdrift/kumiko-bundled-features@0.33.0
  - @cosmicdrift/kumiko-framework@0.33.0

## 0.32.1

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.32.1
- @cosmicdrift/kumiko-framework@0.32.1

## 0.32.0

### Patch Changes

- Updated dependencies [05c4447]
- Updated dependencies [0009486]
  - @cosmicdrift/kumiko-framework@0.32.0
  - @cosmicdrift/kumiko-bundled-features@0.32.0

## 0.31.1

### Patch Changes

- Updated dependencies [6f79d05]
  - @cosmicdrift/kumiko-framework@0.31.1
  - @cosmicdrift/kumiko-bundled-features@0.31.1

## 0.31.0

### Patch Changes

- Updated dependencies [b74ddbe]
- Updated dependencies [5b1a594]
  - @cosmicdrift/kumiko-framework@0.31.0
  - @cosmicdrift/kumiko-bundled-features@0.31.0

## 0.30.0

### Patch Changes

- Updated dependencies [00020b4]
  - @cosmicdrift/kumiko-framework@0.30.0
  - @cosmicdrift/kumiko-bundled-features@0.30.0

## 0.29.0

### Patch Changes

- 581b5e9: run-prod-app: static-fallback served index.html nur noch für GET/HEAD — non-GET ohne Hono-Match liefert den Hono-404 durch (vorher 200 index.html, wodurch z.B. falsch konfigurierte Webhook-Endpoints als delivered galten).
- Updated dependencies [f9d41ae]
- Updated dependencies [290a05b]
- Updated dependencies [4398d02]
- Updated dependencies [3186d8a]
  - @cosmicdrift/kumiko-framework@0.29.0
  - @cosmicdrift/kumiko-bundled-features@0.29.0

## 0.28.0

### Minor Changes

- 743db9b: extraRoutes-deps liefern jetzt `registry` + `dispatchSystemWrite` (runProdApp + createKumikoServer/runDevApp) — das Wiring, das `createSubscriptionWebhookHandler` für Provider-Webhook-Routen braucht. Dazu: `KumikoServer`/`ApiEntrypoint`/`TestStack` exponieren den Command-Dispatcher, `createSystemUser` nimmt optionale `extraRoles` (kein Access-Bypass für die system-Rolle — Ziel-Handler gaten auf explizite Rollen wie SystemAdmin).

### Patch Changes

- Updated dependencies [743db9b]
- Updated dependencies [e42fef9]
  - @cosmicdrift/kumiko-framework@0.28.0
  - @cosmicdrift/kumiko-bundled-features@0.28.0

## 0.27.0

### Patch Changes

- Updated dependencies [ea365d1]
  - @cosmicdrift/kumiko-bundled-features@0.27.0
  - @cosmicdrift/kumiko-framework@0.27.0

## 0.26.0

### Patch Changes

- Updated dependencies [ed1ce4b]
- Updated dependencies [b539942]
  - @cosmicdrift/kumiko-bundled-features@0.26.0
  - @cosmicdrift/kumiko-framework@0.26.0

## 0.25.0

### Patch Changes

- Updated dependencies [924d48c]
  - @cosmicdrift/kumiko-framework@0.25.0
  - @cosmicdrift/kumiko-bundled-features@0.25.0

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
- Updated dependencies [b497f4d]
- Updated dependencies [52cd396]
- Updated dependencies [c5fe2ba]
  - @cosmicdrift/kumiko-framework@0.24.1
  - @cosmicdrift/kumiko-bundled-features@0.24.1

## 0.24.0

### Patch Changes

- Updated dependencies [c5b7d99]
  - @cosmicdrift/kumiko-framework@0.24.0
  - @cosmicdrift/kumiko-bundled-features@0.24.0

## 0.23.1

### Patch Changes

- Updated dependencies [88d492a]
  - @cosmicdrift/kumiko-framework@0.23.1
  - @cosmicdrift/kumiko-bundled-features@0.23.1

## 0.23.0

### Patch Changes

- e27b7b7: Fix deploy-template drift after the drizzle→`kumiko schema` cutover. Three stale references in the scaffolded `Dockerfile` + `migrate-step.sh` broke every fresh deploy and would have re-broken existing deploys on the next re-scaffold:

  - `Dockerfile.template` copied `/app/dist-server/drizzle.config.ts`, which the single-bundle server build (0.20.0) no longer emits — Docker `COPY` of a missing source fails hard.
  - `Dockerfile.template` copied `/app/drizzle`, but apps on the new schema pipeline (0.21.0) ship `kumiko/migrations/` instead. The COPY broke for apps without a legacy `drizzle/` directory, and even when it succeeded the SQL the runtime needs (`${INIT_CWD}/kumiko/migrations/*.sql`) was missing. Replaced with `COPY /app/kumiko/migrations ./kumiko/migrations`.
  - `Dockerfile.template` set `ENV KUMIKO_MIGRATION_HOOKS=/app/migration-hooks.js`, pointing at a bundle output that 0.20.0 also dropped. The new `schema apply` path doesn't read this env — removed.
  - `migrate-step.sh.template` invoked `bun /app/kumiko.js migrate apply`, but the CLI registers no `migrate` command — only `schema apply`. The pre-deploy migrate step crashed with `Unknown command: migrate`. Fixed to `bun /app/kumiko.js schema apply`.

  Header comments + `KUMIKO_REPO_ROOT`/`INIT_CWD` annotations rewritten to describe the schema-CLI path instead of drizzle-kit. Two new regression tests in `scaffold-deploy.test.ts` lock the migrate command + pin the kumiko/migrations COPY so this drift can't silently return.

  This corrects the "no deploy change" claim in the 0.20.0 changelog entry: 0.20.0 was a deploy-template change, the templates just hadn't been updated.

- Updated dependencies [e27b7b7]
- Updated dependencies [8289134]
  - @cosmicdrift/kumiko-framework@0.23.0
  - @cosmicdrift/kumiko-bundled-features@0.23.0

## 0.22.0

### Patch Changes

- Updated dependencies [dcc8d4c]
- Updated dependencies [edebd91]
- Updated dependencies [dcc8d4c]
- Updated dependencies [4156981]
- Updated dependencies [62bf38b]
  - @cosmicdrift/kumiko-bundled-features@0.22.0
  - @cosmicdrift/kumiko-framework@0.22.0

## 0.21.1

### Patch Changes

- Updated dependencies [0809f08]
  - @cosmicdrift/kumiko-bundled-features@0.21.1
  - @cosmicdrift/kumiko-framework@0.21.1

## 0.21.0

### Patch Changes

- Updated dependencies [c1a044b]
  - @cosmicdrift/kumiko-framework@0.21.0
  - @cosmicdrift/kumiko-bundled-features@0.21.0

## 0.20.0

### Minor Changes

- 6777250: Server build: bundle all server entries in a single `Bun.build` with code splitting so the framework is emitted once as a shared chunk instead of inlined per entry. `dist-server/` shrinks ~66% (publicstatus ~41 MB → ~14 MB), boot/migrate stay separate entries, no deploy change. Drops the dead drizzle `migration-hooks.js` + `drizzle.config.ts` bundling and the `drizzle-kit`/`drizzle-orm` runtime externals — the migrate path uses `runMigrationsFromDir`.

  Schema migrations: `kumiko schema generate` now writes a `NNNN_<name>.rebuild.json` marker next to each migration listing the changed/new tables, so the apply step can rebuild the affected projections. New helpers `writeRebuildMarker` / `readRebuildMarker` / `rebuildTablesFromDiff` are exported from the `db` entrypoint.

### Patch Changes

- Updated dependencies [6777250]
  - @cosmicdrift/kumiko-framework@0.20.0
  - @cosmicdrift/kumiko-bundled-features@0.20.0

## 0.19.1

### Patch Changes

- a146fc4: Add shared boot-seed contract (`SeedIfExists`, `runEventStoreSeed`) and default skip-if-exists for `seedTextBlock` / `seedComplianceProfile`.
- Updated dependencies [a146fc4]
  - @cosmicdrift/kumiko-framework@0.19.1
  - @cosmicdrift/kumiko-bundled-features@0.19.1

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

### Patch Changes

- Updated dependencies [2c84510]
  - @cosmicdrift/kumiko-framework@0.19.0
  - @cosmicdrift/kumiko-bundled-features@0.19.0

## 0.18.0

### Patch Changes

- Updated dependencies [ff49c38]
  - @cosmicdrift/kumiko-framework@0.18.0
  - @cosmicdrift/kumiko-bundled-features@0.18.0

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

### Patch Changes

- Updated dependencies [239e9dc]
  - @cosmicdrift/kumiko-framework@0.17.0
  - @cosmicdrift/kumiko-bundled-features@0.17.0

## 0.16.0

### Patch Changes

- Updated dependencies [1dcc743]
- Updated dependencies [9aeabb3]
  - @cosmicdrift/kumiko-framework@0.16.0
  - @cosmicdrift/kumiko-bundled-features@0.16.0

## 0.15.0

### Patch Changes

- Updated dependencies [79d5891]
- Updated dependencies [5a7f7ac]
  - @cosmicdrift/kumiko-bundled-features@0.15.0
  - @cosmicdrift/kumiko-framework@0.15.0

## 0.14.0

### Minor Changes

- b8e1d48: scaffoldApp baut `src/run-config.ts` + `bin/main.ts` jetzt via ts-morph
  (AST) statt template-strings. Selbes Tool wie scaffoldAppFeature →
  ein konsistenter Mechanismus für generate + later modify. Plus:
  ts-morph als explicit dependency aufgenommen (war bisher nur via
  hoisted root-dep verfügbar; broken bei publish).

### Patch Changes

- ce23d48: `walkthrough.integration.ts` — DX-3.1 walkthrough-snapshot-test. Pins
  scaffoldApp + scaffoldAppFeature output gegen die Behauptungen in
  docs.kumiko.rocks/en/walkthrough/. Catches doc-drift ohne actual
  `bunx … && yarn install && bun run boot` CI-run.

  5 Tests: file-list, auto-mount-diff, run-config text-content,
  composeFeatures(includeBundled:true) = 7 features, bin/main auth.admin
  stub.

  - @cosmicdrift/kumiko-framework@0.14.0
  - @cosmicdrift/kumiko-bundled-features@0.14.0

## 0.13.0

### Minor Changes

- 7bd5c88: `KUMIKO_DRY_RUN_ENV=boot` mode for runProdApp — runs env-validation +
  composeFeatures + validateBoot + createRegistry without DB/Redis
  connect, exits with status 0 on success. Used by the
  `samples/apps/use-all-bundled` smoke-app (Sprint 9.8 Phase C / Empfehlung
  1 / canonical bug-catcher) and downstream by enterprise's
  `use-all-features` mirror. Render-modes (human|json|pulumi|k8s|1)
  behavior unchanged.
- 575752f: `scaffoldAppFeature` + `kumiko add feature <name>` — DX-2 aus DX-Roadmap.
  Scaffolded ein neues Feature in `src/features/<name>/` einer bereits via
  `kumiko new app` scaffolded App + **auto-mountet** es in `src/run-config.ts`
  via ts-morph (import + `APP_FEATURES`-array-entry, idempotent).

  User-Promise "defineFeature → nichts woanders eintragen" erfüllt für die
  run-config-Seite. FEATURE_IMPORT_REGISTRY in drizzle/generate.ts ist
  DX-4's Refactor — bei DX-1+DX-2-App noch nicht vorhanden.

  Usage (in einer DX-1-gescaffoldeten App):

  ```sh
  bunx kumiko add feature product-catalog
  # → src/features/product-catalog/{feature.ts,index.ts}
  # → src/run-config.ts auto-edited: import + APP_FEATURES-entry
  ```

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

- 46b84d0: `scaffoldApp` + `kumiko new app <name>` — DX-1.0 aus DX-Roadmap. Generiert
  ein lauffähiges App-Skelett (package.json, tsconfig, run-config mit
  secrets+sessions, bin/main.ts mit auth-admin-stub + deterministische
  tenant-UUID, .env.example, README) in `<cwd>/<name>/`.

  Boot-Pfad: `KUMIKO_DRY_RUN_ENV=boot bun bin/main.ts` läuft ohne DB/Redis.

  Held-back für spätere DX-Phasen: drizzle-setup (DX-1.1, blocked-by DX-4
  auto-registry), Dockerfile (existing `kumiko init-deploy`), first feature
  scaffold (existing `kumiko create` bzw. DX-2 `kumiko add feature`).

  Usage:

  ```sh
  bunx kumiko new app my-shop
  cd my-shop && yarn install
  cp .env.example .env  # JWT_SECRET + KUMIKO_SECRETS_MASTER_KEY_V1 setzen
  bun run boot          # → boot validation OK
  ```

### Patch Changes

- 2bd60c1: `buildServerBundle` BUILD_ONLY_EXTERNALS erweitert um drizzle-kit's
  dialect-resolver dynamic-imports: `@planetscale/database`, `@libsql/client`,
  `better-sqlite3`, `@neondatabase/serverless`, `@vercel/postgres`, `mysql2`.

  Aufgedeckt durch C1 Empfehlung 4 (bundle-smoke). Bisher schlug
  `bun build` an dynamic-imports im drizzle-kit auch wenn der App nur
  postgres nutzt. Externalisieren = build durchläuft + tree-shake wirft
  die ungenutzten driver-modules eh raus.

- 8bfb284: Dockerfile.template setzt `YARN_ENABLE_SCRIPTS=false` im Build-Stage. Fixt msgpackr-extract native-build-Failures (ARM, CI) und generell jeden transitiven Native-Dep — der Build-Stage bundlet nur JS via `bun build`, Runtime-Native-Deps werden separat im Runtime-Stage via `bun install --production` installiert. Apps die bisher per-package-Workarounds via `dependenciesMeta.<pkg>.built=false` in der App-package.json brauchten (studio, enterprise) können diese Entries nach Upgrade auf diese dev-server-Version entfernen.
- cc0ddc0: `Dockerfile.template` emits an inline `start.sh` for createBunServer command-override target.

  `infra/pulumi/bun-server.ts`'s `createBunServer` overrides the container command with `exec ./start.sh` after injecting DATABASE_URL from the init-container. Apps deployed via createBunServer crashed with `./start.sh: not found` until each one added a per-app `start.sh` in repo root (= studio's PR #22).

  Now the Dockerfile-template emits the file inline (`RUN printf … > ./start.sh && chmod +x`). Apps no longer need to ship one — the runtime stage generates it. Apps that don't go through createBunServer's command-override still boot via the bottom CMD; start.sh is dead-code in that case.

- Updated dependencies [7f56b2f]
- Updated dependencies [68b8118]
- Updated dependencies [9121928]
- Updated dependencies [72518fa]
- Updated dependencies [0a00e7b]
- Updated dependencies [aca1443]
- Updated dependencies [c6cb96c]
- Updated dependencies [3d5e9ef]
  - @cosmicdrift/kumiko-framework@0.13.0
  - @cosmicdrift/kumiko-bundled-features@0.13.0

## 0.12.2

### Patch Changes

- Updated dependencies [597de52]
  - @cosmicdrift/kumiko-framework@0.12.2
  - @cosmicdrift/kumiko-bundled-features@0.12.2

## 0.12.1

### Patch Changes

- Updated dependencies [f2ad7c4]
  - @cosmicdrift/kumiko-framework@0.12.1
  - @cosmicdrift/kumiko-bundled-features@0.12.1

## 0.12.0

### Patch Changes

- Updated dependencies [0c1ebe5]
  - @cosmicdrift/kumiko-bundled-features@0.12.0
  - @cosmicdrift/kumiko-framework@0.12.0

## 0.11.2

### Patch Changes

- Updated dependencies [92a84f0]
  - @cosmicdrift/kumiko-framework@0.11.2
  - @cosmicdrift/kumiko-bundled-features@0.11.2

## 0.11.1

### Patch Changes

- Updated dependencies [e6f702f]
  - @cosmicdrift/kumiko-bundled-features@0.11.1
  - @cosmicdrift/kumiko-framework@0.11.1

## 0.11.0

### Patch Changes

- Updated dependencies [30ea981]
- Updated dependencies [9347212]
  - @cosmicdrift/kumiko-framework@0.11.0
  - @cosmicdrift/kumiko-bundled-features@0.11.0

## 0.10.0

### Patch Changes

- Updated dependencies [d06f029]
- Updated dependencies [753d392]
  - @cosmicdrift/kumiko-framework@0.10.0
  - @cosmicdrift/kumiko-bundled-features@0.10.0

## 0.9.0

### Minor Changes

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

- 37fe758: `scaffoldDeploy()` inspects the app source-tree and emits Dockerfile blocks conditionally (Sprint 9.6 follow-up).

  **Why this exists:** Sprint 9.6's first Dockerfile.template hardcoded `COPY --from=build /app/seeds ./seeds` with a "comment out if you don't use it" note in the changeset. Apps without a `seeds/` directory (e.g. studio.kumiko.rocks) crashed in Docker-build with `failed to compute cache key: "/app/seeds": not found`. Root-cause was a framework issue (template too rigid), not a per-app symptom — the framework should detect what the app actually has.

  **Detection:**

  - `hasSeeds` — `exists(sourceDir/seeds)`. Drives the ES-Ops `COPY ./seeds` block in the runtime stage.
  - `hasPrivateGhPackages` — scan `package.json` `dependencies` + `devDependencies` for any `@cosmicdriftgamestudio/*` entry. Drives the `ARG GITHUB_TOKEN` blocks (multi-stage with explicit re-declaration inside the build-stage) and the `ENV GITHUB_TOKEN=${GITHUB_TOKEN}` re-export before `yarn install --immutable`.

  **Template syntax:** mustache-style block conditionals `{{#flag}}…{{/flag}}` (multi-line via `[\s\S]`, surrounding line stripped on falsy). Plain `{{key}}` placeholder substitution is unchanged.

  **New API:**

  - `ScaffoldDeployOptions.sourceDir?: string` — defaults to `destination`. Lets the caller scaffold into one dir while detecting optional surfaces in another (rare).
  - `ScaffoldDeployResult.detected: { hasSeeds, hasPrivateGhPackages }` — surfaced so the CLI can report what was emitted.

  **6 new tests:** seeds detection (with + without), GH-Packages detection (private + public-only + malformed package.json).

  Sprint 9.6's "starting point not contract" disclaimer in the original changeset is now obsolete for these two surfaces — apps no longer need to manually comment out lines.

### Patch Changes

- Updated dependencies [51e22f5]
  - @cosmicdrift/kumiko-framework@0.9.0
  - @cosmicdrift/kumiko-bundled-features@0.9.0

## 0.8.1

### Patch Changes

- Updated dependencies [4b5f91e]
  - @cosmicdrift/kumiko-framework@0.8.1
  - @cosmicdrift/kumiko-bundled-features@0.8.1

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

### Patch Changes

- Updated dependencies [145b8df]
- Updated dependencies [f34af9a]
- Updated dependencies [dff4123]
  - @cosmicdrift/kumiko-bundled-features@0.8.0
  - @cosmicdrift/kumiko-framework@0.8.0

## 0.7.0

### Minor Changes

- bcf43b6: es-ops: `SeedMembershipRow` exposes `streamTenantId` (stream-tenant aus `kumiko_events.v1`) neben dem payload-`tenantId`. Seed-Authors müssen den `kumiko_events`-JOIN nicht mehr selbst bauen — `m.streamTenantId` ist der korrekte Wert für `systemWriteAs`'s `tenantIdOverride` wenn das Aggregate von einem fremden Executor angelegt wurde (typisches `seedTenantMembership(by=systemAdmin)`-Pattern).

### Patch Changes

- Updated dependencies [bcf43b6]
  - @cosmicdrift/kumiko-framework@0.7.0
  - @cosmicdrift/kumiko-bundled-features@0.7.0

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
  - @cosmicdrift/kumiko-bundled-features@0.6.0

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
  - @cosmicdrift/kumiko-bundled-features@0.5.2

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
  - @cosmicdrift/kumiko-bundled-features@0.5.1

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
  - @cosmicdrift/kumiko-bundled-features@0.5.0

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
  - @cosmicdrift/kumiko-bundled-features@0.4.1

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
  - @cosmicdrift/kumiko-bundled-features@0.4.0

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
  - @cosmicdrift/kumiko-bundled-features@0.3.0

## 0.2.3

### Patch Changes

- Updated dependencies [1dbd038]
  - @cosmicdrift/kumiko-bundled-features@0.2.3
  - @cosmicdrift/kumiko-framework@0.2.3

## 0.2.2

### Patch Changes

- 7a7da3e: Re-publish 0.2.1 → 0.2.2 mit korrekt aufgelösten cross-package-Versionen.
  0.2.1 hatte `workspace:*` als Wert in den dependencies (npm publish ohne
  yarn-pack rewrite), Konsumenten bekamen "Workspace not found".

  publish-with-oidc.sh nutzt jetzt `yarn pack` (rewrited workspace:\*) +
  `npm publish <tarball>` (OIDC + provenance).

- Updated dependencies [7a7da3e]
  - @cosmicdrift/kumiko-framework@0.2.2
  - @cosmicdrift/kumiko-bundled-features@0.2.2

## 0.2.1

### Patch Changes

- 48b7f6a: CI: switch publish to npm-CLI with OIDC Trusted Publishing + provenance.
  No source changes — verifies the new publish path produces a verified-
  provenance attestation on npmjs.com instead of token-based publish.
- Updated dependencies [48b7f6a]
  - @cosmicdrift/kumiko-framework@0.2.1
  - @cosmicdrift/kumiko-bundled-features@0.2.1

## 0.2.0

### Minor Changes

- 6c70b6f: fix(tenant): seedTenant idempotent gegen Event-Store-Projection-Drift.

  Verhindert version_conflict beim App-Boot wenn Aggregat existiert aber
  Projection-Row fehlt (rebuild-drift, async-lag, manueller DB-Eingriff).

### Patch Changes

- Updated dependencies [6c70b6f]
  - @cosmicdrift/kumiko-framework@0.2.0
  - @cosmicdrift/kumiko-bundled-features@0.2.0

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
  - @cosmicdrift/kumiko-bundled-features@0.1.0
