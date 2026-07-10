# @cosmicdrift/kumiko-bundled-features

## 0.137.0

### Patch Changes

- Updated dependencies [fdd7c40]
  - @cosmicdrift/kumiko-framework@0.137.0
  - @cosmicdrift/kumiko-renderer-web@0.137.0
  - @cosmicdrift/kumiko-headless@0.137.0
  - @cosmicdrift/kumiko-renderer@0.137.0
  - @cosmicdrift/kumiko-dispatcher-live@0.137.0

## 0.136.1

### Patch Changes

- Updated dependencies [74ed322]
  - @cosmicdrift/kumiko-renderer-web@0.136.1
  - @cosmicdrift/kumiko-framework@0.136.1
  - @cosmicdrift/kumiko-dispatcher-live@0.136.1
  - @cosmicdrift/kumiko-headless@0.136.1
  - @cosmicdrift/kumiko-renderer@0.136.1

## 0.136.0

### Patch Changes

- Updated dependencies [f5a7f51]
  - @cosmicdrift/kumiko-framework@0.136.0
  - @cosmicdrift/kumiko-renderer-web@0.136.0
  - @cosmicdrift/kumiko-headless@0.136.0
  - @cosmicdrift/kumiko-renderer@0.136.0
  - @cosmicdrift/kumiko-dispatcher-live@0.136.0

## 0.135.0

### Patch Changes

- Updated dependencies [3579d24]
  - @cosmicdrift/kumiko-renderer-web@0.135.0
  - @cosmicdrift/kumiko-framework@0.135.0
  - @cosmicdrift/kumiko-dispatcher-live@0.135.0
  - @cosmicdrift/kumiko-headless@0.135.0
  - @cosmicdrift/kumiko-renderer@0.135.0

## 0.134.0

### Patch Changes

- Updated dependencies [9eab762]
  - @cosmicdrift/kumiko-framework@0.134.0
  - @cosmicdrift/kumiko-renderer@0.134.0
  - @cosmicdrift/kumiko-renderer-web@0.134.0
  - @cosmicdrift/kumiko-headless@0.134.0
  - @cosmicdrift/kumiko-dispatcher-live@0.134.0

## 0.133.0

### Patch Changes

- Updated dependencies [9521906]
  - @cosmicdrift/kumiko-framework@0.133.0
  - @cosmicdrift/kumiko-headless@0.133.0
  - @cosmicdrift/kumiko-renderer@0.133.0
  - @cosmicdrift/kumiko-dispatcher-live@0.133.0
  - @cosmicdrift/kumiko-renderer-web@0.133.0

## 0.132.0

### Patch Changes

- Updated dependencies [2d40746]
  - @cosmicdrift/kumiko-renderer-web@0.132.0
  - @cosmicdrift/kumiko-framework@0.132.0
  - @cosmicdrift/kumiko-dispatcher-live@0.132.0
  - @cosmicdrift/kumiko-headless@0.132.0
  - @cosmicdrift/kumiko-renderer@0.132.0

## 0.131.0

### Minor Changes

- d814026: App-Mounting 2.0 Säule A: Mid-Level-Widget-Kit in renderer-web (StatCard, MiniStat, SectionCard, StatusBadge, ProgressBar, CollapsibleSection, DetailList, ModeSwitch, StatusBarChart, TimeseriesChart, EmptyState/LoadingState/ErrorState, QueryTable) + Status-Farb-Tokens (--color-status-\*). Neue Hooks useMutation + useDisclosure. Neues Core-Primitive Link (default/button/muted), Button-Variant "link", Text-Variant "muted"; auth-email-password nutzt sie (authButtonClass/authMutedLinkClass entfernt).

### Patch Changes

- Updated dependencies [99008c9]
- Updated dependencies [d814026]
  - @cosmicdrift/kumiko-framework@0.131.0
  - @cosmicdrift/kumiko-renderer@0.131.0
  - @cosmicdrift/kumiko-renderer-web@0.131.0
  - @cosmicdrift/kumiko-headless@0.131.0
  - @cosmicdrift/kumiko-dispatcher-live@0.131.0

## 0.130.2

### Patch Changes

- 98ed535: Content-Tree + Config-Nav Sysadmin-Shell polish:

  - text-content: Leaf-Knoten tragen jetzt ein `file`-Icon statt eines Dots; der Editor läuft auf der Page-Shell (`Form`-Primitive mit Card statt des entfernten `FormPanelShell`).
  - Sidebar-Nav bekommt ein Suchfeld, das den Baum live filtert (Treffer + ihre Ancestors bleiben, zugeklappte Ordner öffnen für die Suche).
  - Ordner-Knoten zeigen `folder-open` wenn ausgeklappt.
  - NAV_ICONS um `server`, `mail`, `lock`, `hash`, `download`, `folder-open` ergänzt — SMTP-/Config-Nav-Kinder (z.B. „Email-Versand") rendern damit ein Icon statt blank.
  - Verschachtelte Provider-Ordner (Content-Tree) rendern ihre Kinder in einem `<ul>` (valides HTML + Einrück-Stufe pro Tiefe) statt `<li>`-in-`<li>`.
  - Platform-Overview: `user:query:user:list` in der Allowlist (behebt den Overview-Crash).

- Updated dependencies [98ed535]
  - @cosmicdrift/kumiko-renderer-web@0.130.2
  - @cosmicdrift/kumiko-renderer@0.130.2
  - @cosmicdrift/kumiko-framework@0.130.2
  - @cosmicdrift/kumiko-dispatcher-live@0.130.2
  - @cosmicdrift/kumiko-headless@0.130.2

## 0.130.1

### Patch Changes

- Updated dependencies
  - @cosmicdrift/kumiko-renderer@0.130.1
  - @cosmicdrift/kumiko-renderer-web@0.130.1
  - @cosmicdrift/kumiko-framework@0.130.1
  - @cosmicdrift/kumiko-dispatcher-live@0.130.1
  - @cosmicdrift/kumiko-headless@0.130.1

## 0.130.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.130.0
- @cosmicdrift/kumiko-dispatcher-live@0.130.0
- @cosmicdrift/kumiko-headless@0.130.0
- @cosmicdrift/kumiko-renderer@0.130.0
- @cosmicdrift/kumiko-renderer-web@0.130.0

## 0.129.0

### Patch Changes

- Updated dependencies [3247676]
  - @cosmicdrift/kumiko-framework@0.129.0
  - @cosmicdrift/kumiko-headless@0.129.0
  - @cosmicdrift/kumiko-renderer@0.129.0
  - @cosmicdrift/kumiko-dispatcher-live@0.129.0
  - @cosmicdrift/kumiko-renderer-web@0.129.0

## 0.128.0

### Patch Changes

- Updated dependencies [d340977]
  - @cosmicdrift/kumiko-headless@0.128.0
  - @cosmicdrift/kumiko-dispatcher-live@0.128.0
  - @cosmicdrift/kumiko-renderer@0.128.0
  - @cosmicdrift/kumiko-renderer-web@0.128.0
  - @cosmicdrift/kumiko-framework@0.128.0

## 0.127.0

### Minor Changes

- f5d37a1: Harden admin operator UI: stricter boot i18n/entityList validation, job run logger wiring, audit/job filters, shell breadcrumbs, and bundled entityList/i18n standards.

### Patch Changes

- Updated dependencies [f5d37a1]
  - @cosmicdrift/kumiko-framework@0.127.0
  - @cosmicdrift/kumiko-renderer-web@0.127.0
  - @cosmicdrift/kumiko-headless@0.127.0
  - @cosmicdrift/kumiko-renderer@0.127.0
  - @cosmicdrift/kumiko-dispatcher-live@0.127.0

## 0.126.0

### Patch Changes

- Updated dependencies [0c482c3]
  - @cosmicdrift/kumiko-framework@0.126.0
  - @cosmicdrift/kumiko-headless@0.126.0
  - @cosmicdrift/kumiko-renderer@0.126.0
  - @cosmicdrift/kumiko-dispatcher-live@0.126.0
  - @cosmicdrift/kumiko-renderer-web@0.126.0

## 0.125.2

### Patch Changes

- Updated dependencies [a6f3f48]
  - @cosmicdrift/kumiko-renderer@0.125.2
  - @cosmicdrift/kumiko-renderer-web@0.125.2
  - @cosmicdrift/kumiko-framework@0.125.2
  - @cosmicdrift/kumiko-dispatcher-live@0.125.2
  - @cosmicdrift/kumiko-headless@0.125.2

## 0.125.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.125.1
- @cosmicdrift/kumiko-dispatcher-live@0.125.1
- @cosmicdrift/kumiko-headless@0.125.1
- @cosmicdrift/kumiko-renderer@0.125.1
- @cosmicdrift/kumiko-renderer-web@0.125.1

## 0.125.0

### Minor Changes

- 8d1353b: admin-shell: neues bundled-feature für rollen-gated Tenant- und Platform-Workspaces mit Overview-Home-Screens, Nav-Icons und Server-i18n. Komponiert Screens aus `tenant`, `audit`, `jobs` und optional `tier-engine` — mount nach diesen Features. Overview-Queries laufen über eine fest kodierte Allowlist pro Workspace, um versehentliche Cross-Workspace-Datenzugriffe zu verhindern.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.125.0
- @cosmicdrift/kumiko-dispatcher-live@0.125.0
- @cosmicdrift/kumiko-headless@0.125.0
- @cosmicdrift/kumiko-renderer@0.125.0
- @cosmicdrift/kumiko-renderer-web@0.125.0

## 0.124.0

### Patch Changes

- Updated dependencies [50d7423]
  - @cosmicdrift/kumiko-renderer@0.124.0
  - @cosmicdrift/kumiko-renderer-web@0.124.0
  - @cosmicdrift/kumiko-framework@0.124.0
  - @cosmicdrift/kumiko-dispatcher-live@0.124.0
  - @cosmicdrift/kumiko-headless@0.124.0

## 0.123.3

### Patch Changes

- 57ebd1d: page-render: neuer `./page-render/web`-Subpath für client-safe Exports (renderSafeMarkdown, sanitizeTenantCss, wrapInLayout, branding-Helpers, securePageHeaders). Der bestehende `./page-render`-Barrel re-exportierte auch `cachedSecurePageResponse`, das transitiv `@cosmicdrift/kumiko-framework/api` (postgres/ioredis) zieht — jeder Import aus dem Barrel in Client-Code ließ den Browser-Bundle mit "Bundle failed" crashen, ohne brauchbare Fehlermeldung.
  - @cosmicdrift/kumiko-framework@0.123.3
  - @cosmicdrift/kumiko-dispatcher-live@0.123.3
  - @cosmicdrift/kumiko-headless@0.123.3
  - @cosmicdrift/kumiko-renderer@0.123.3
  - @cosmicdrift/kumiko-renderer-web@0.123.3

## 0.123.2

### Patch Changes

- 581a3b6: Consistency: user-profile's ProfileScreen adopts the shared `FormScreenShell` (centered `max-w-3xl` like all other settings screens, was left-aligned `max-w-5xl`). DataTable now sits on `bg-card` instead of a transparent surface — on themes with a colored page background (e.g. cream) lists previously didn't match the white cards; now they do.
- Updated dependencies [581a3b6]
  - @cosmicdrift/kumiko-renderer-web@0.123.2
  - @cosmicdrift/kumiko-framework@0.123.2
  - @cosmicdrift/kumiko-dispatcher-live@0.123.2
  - @cosmicdrift/kumiko-headless@0.123.2
  - @cosmicdrift/kumiko-renderer@0.123.2

## 0.123.1

### Patch Changes

- cf63778: managed-pages: add a `./managed-pages/web` client export (`managedPagesClient()`) so apps can register the feature's admin-screen translations into the browser i18n store. Previously the server-side `r.translations` bundle never reached the client, so configEdit/entityEdit labels (branding, page CMS) rendered as raw i18n keys in the admin UI. The client bundle is pivoted from the same `MANAGED_PAGES_I18N` source (no key duplication).

  renderer-web: extract a shared `FormScreenShell` primitive — the canonical centered `max-w-3xl` form/settings column that `DefaultForm` (configEdit/entityEdit) already used. Exporting it lets custom settings screens share the exact same width + centering instead of each author re-inventing the wrapper. `user-data-rights`' privacy-center screen adopts it.

- Updated dependencies [cf63778]
  - @cosmicdrift/kumiko-renderer-web@0.123.1
  - @cosmicdrift/kumiko-framework@0.123.1
  - @cosmicdrift/kumiko-dispatcher-live@0.123.1
  - @cosmicdrift/kumiko-headless@0.123.1
  - @cosmicdrift/kumiko-renderer@0.123.1

## 0.123.0

### Patch Changes

- b0e70a7: headless: new `html` tagged template + `raw()`/`RawHtml` — auto-escapes every interpolation, `raw()` marks prerendered markup, nested `html` fragments compose without double-escaping. Structural companion to the new HTML-escape guard (infra#201).

  Hardening from the guard's first run: apex JSON-LD `<script>` block serializes `<` as `<` (no `</script>` breakout), dev-server `injectSchema` does the same for `window.__KUMIKO_SCHEMA__`; apex/page-render prerendered fragments renamed to the `*Html` convention.

- Updated dependencies [b0e70a7]
  - @cosmicdrift/kumiko-headless@0.123.0
  - @cosmicdrift/kumiko-dispatcher-live@0.123.0
  - @cosmicdrift/kumiko-renderer@0.123.0
  - @cosmicdrift/kumiko-renderer-web@0.123.0
  - @cosmicdrift/kumiko-framework@0.123.0

## 0.122.5

### Patch Changes

- 837e3b3: managed-pages: ship de/en translations for its admin screens (branding settings + page CMS) via `r.translations`, so field labels, section headers and screen titles no longer render as raw i18n keys. Any app mounting `managed-pages` now boots with a complete, translated admin surface. Also adds `tag` and `key` to the nav-icon allowlist (`NAV_ICONS`) so nav entries using those keys render a Lucide icon instead of the grey dot fallback.
- Updated dependencies [837e3b3]
  - @cosmicdrift/kumiko-renderer-web@0.122.5
  - @cosmicdrift/kumiko-framework@0.122.5
  - @cosmicdrift/kumiko-dispatcher-live@0.122.5
  - @cosmicdrift/kumiko-headless@0.122.5
  - @cosmicdrift/kumiko-renderer@0.122.5

## 0.122.4

### Patch Changes

- Updated dependencies [2dd0d9e]
  - @cosmicdrift/kumiko-framework@0.122.4
  - @cosmicdrift/kumiko-headless@0.122.4
  - @cosmicdrift/kumiko-renderer@0.122.4
  - @cosmicdrift/kumiko-dispatcher-live@0.122.4
  - @cosmicdrift/kumiko-renderer-web@0.122.4

## 0.122.3

### Patch Changes

- Updated dependencies [1693324]
  - @cosmicdrift/kumiko-framework@0.122.3
  - @cosmicdrift/kumiko-headless@0.122.3
  - @cosmicdrift/kumiko-renderer@0.122.3
  - @cosmicdrift/kumiko-dispatcher-live@0.122.3
  - @cosmicdrift/kumiko-renderer-web@0.122.3

## 0.122.2

### Patch Changes

- Updated dependencies [a9a6d80]
  - @cosmicdrift/kumiko-framework@0.122.2
  - @cosmicdrift/kumiko-headless@0.122.2
  - @cosmicdrift/kumiko-renderer@0.122.2
  - @cosmicdrift/kumiko-dispatcher-live@0.122.2
  - @cosmicdrift/kumiko-renderer-web@0.122.2

## 0.122.1

### Patch Changes

- Updated dependencies [8665f63]
  - @cosmicdrift/kumiko-framework@0.122.1
  - @cosmicdrift/kumiko-headless@0.122.1
  - @cosmicdrift/kumiko-renderer@0.122.1
  - @cosmicdrift/kumiko-dispatcher-live@0.122.1
  - @cosmicdrift/kumiko-renderer-web@0.122.1

## 0.122.0

### Patch Changes

- e069b64: user-data-rights: export-download-token re-runs rotate the token in place on the
  same aggregate (update) instead of creating a second aggregate for the same
  jobId. A second `created` event without a `deleted` in between made every
  projection rebuild collide on the `one_per_job` unique index (fw#832). Operator
  recovery after a lost plain token is now just "flip the job back to pending" —
  never delete the token row read-side.
- Updated dependencies [446f933]
- Updated dependencies [e069b64]
  - @cosmicdrift/kumiko-framework@0.122.0
  - @cosmicdrift/kumiko-headless@0.122.0
  - @cosmicdrift/kumiko-renderer@0.122.0
  - @cosmicdrift/kumiko-dispatcher-live@0.122.0
  - @cosmicdrift/kumiko-renderer-web@0.122.0

## 0.121.1

### Patch Changes

- Updated dependencies [0af1fe1]
  - @cosmicdrift/kumiko-framework@0.121.1
  - @cosmicdrift/kumiko-headless@0.121.1
  - @cosmicdrift/kumiko-renderer@0.121.1
  - @cosmicdrift/kumiko-dispatcher-live@0.121.1
  - @cosmicdrift/kumiko-renderer-web@0.121.1

## 0.121.0

### Patch Changes

- Updated dependencies [b679dc1]
  - @cosmicdrift/kumiko-framework@0.121.0
  - @cosmicdrift/kumiko-headless@0.121.0
  - @cosmicdrift/kumiko-renderer@0.121.0
  - @cosmicdrift/kumiko-dispatcher-live@0.121.0
  - @cosmicdrift/kumiko-renderer-web@0.121.0

## 0.120.0

### Minor Changes

- c22b711: PII on custom-event payloads (#799). `r.defineEvent(name, schema, { piiFields: { recipientAddress: { subjectField: "recipientId" } } })` declares payload fields that are encrypted under the owning user's DEK (crypto-shredding). Enforcement lives in the low-level event-store `append()` — the single write funnel — so `ctx.appendEvent`, MSP-apply AND out-of-dispatcher writers (delivery attempt-log, jobs run-logger) are all covered; the stored event and the returned echo carry ciphertext, keeping inline projections and rebuilds identical. A null subject field (system cron runs, recipient-less attempts) stays plaintext — there is no user key to shred. Misconfigured `piiFields` (unknown field/subjectField) throw at feature-definition time.

  Bundled features annotated: `delivery:event:attempt`.`recipientAddress` (subject = recipientId) and `jobs` `run-started`.`payload` (subject = triggeredById); the pseudonymous fk ids stay plaintext. `delivery log.query` and `jobs list/details` decrypt for display — a forgotten subject shows `[[erased]]`. This makes the events-only aggregates from #797 Art.-17-capable: user-forget erases the DEK, historical delivery addresses and job payloads become unreadable without touching the append-only stream. New exports: `encryptPiiValueForSubject`, `configureEventPiiCatalog`/`configuredEventPiiCatalog`/`encryptEventPayloadPii` (framework/crypto).

- 433c060: EXT_USER_DATA hooks for the events-only aggregates (deferred from #797, closes the export gap of #799): `delivery-attempt` (per-tenant, by recipientId — recipientAddress decrypts through the export runner's central sweep) and `job-run` (by triggeredById across tenants — job runs live on the SYSTEM tenant). Delete hooks are deliberate no-ops: erasure runs via crypto-shredding, a read-side UPDATE would be wiped on rebuild.

### Patch Changes

- Updated dependencies [29fbdc5]
- Updated dependencies [c22b711]
  - @cosmicdrift/kumiko-framework@0.120.0
  - @cosmicdrift/kumiko-headless@0.120.0
  - @cosmicdrift/kumiko-renderer@0.120.0
  - @cosmicdrift/kumiko-dispatcher-live@0.120.0
  - @cosmicdrift/kumiko-renderer-web@0.120.0

## 0.119.0

### Minor Changes

- b01a4d2: Blind index for PII equality lookups + hard PII boot gate (#818, PRs #819/#821/#822/#823 + this one).

  **BREAKING for apps that mount PII-annotated features (user, tenant, sessions, …) without a KMS:** `runProdApp` now ABORTS boot instead of warning. Either wire `kms: createPgKmsAdapter({ databaseUrl, platformKek })` (plus `blindIndexKey`, env `KUMIKO_BLIND_INDEX_KEY`) or acknowledge explicitly with `allowPlaintextPii: "<reason>"` until your KMS is provisioned. Apps with their own `r.unmanagedTable` stores carrying subject annotations must encrypt on write (`encryptForDirectWrite`) and declare `piiEncryptedOnWrite: true`, or boot fails.

  New: `lookupable: true` on pii text fields maintains an HMAC blind-index column so equality lookups (login by email, dedup checks, invites, password reset) keep working on encrypted columns — query compilers rewrite `eq` filters to `(col = $1 OR col_bidx = $2)`, rollout-neutral for plaintext legacy rows. `user.email` and `tenant-invitation.email` are lookupable; `api-token.name` is `userOwned`; `config.userId`/`notification-preference.userId` are declared `allowPlaintext` (pseudonymous FKs). All bundled read paths that hand stored PII to mails, responses, comparisons or lookups decrypt via the new `decryptStoredPii` helper (13 fixed call sites — with a KMS active, all three invite-accept branches and password-reset mails were previously broken). GDPR exports decrypt every `kumiko-pii:` value centrally. Runtime tripwires: a PII ciphertext in a JSON API response is a loud 500 in dev/test and redacted+logged in prod; outgoing mail to a ciphertext recipient is always refused. Executor write-response echoes (`event.payload`) now carry plaintext (the persisted event log is unchanged). `runDevApp` accepts `kms` + `blindIndexKey` to exercise the full crypto path locally.

- 53da660: Crypto-shredding phase D: forget wire. New `crypto-shredding` bundled feature with the `forget-subject` operator command (DPO/SystemAdmin) — erases a user/tenant subject key and appends a `subject-forgotten` audit event. `user-data-rights` forget-cleanup now erases the user's subject key inside the per-user sub-tx (crash-safe, before the status flip). Fixes `list()` returning ciphertext for camelCase encrypted/pii fields and caching plaintext rows.
- 6ffb71e: Crypto-shredding phase C — event-store PII envelope engine (#724): fields annotated `pii` / `userOwned` / `tenantOwned` are encrypted with the erase subject's DEK at the same executor hook points as `encrypted: true`. Storage format `kumiko-pii:v1:<subjectKey>:<base64(iv|tag|ct)>` names the subject inline; event payload AND projection row carry ciphertext (live == rebuild by construction), legacy plaintext passes through on read. Subject keys are created on first write; reads after `eraseKey` render the `[[erased]]` sentinel; writes to an erased subject fail. `runProdApp({ kms })` wires the engine — without an adapter it stays off (plaintext, pre-phase-C behavior) and boot warns; the hard gate ships with the prod-grade PgKmsAdapter (phase E). Also: `forget()` now re-encrypts `previous` like `delete()` (plaintext of encrypted/pii fields no longer lands in the forgotten event), `userOwned.ownerField` accepts text fields (ES userId-by-convention), and `user-session.ip/userAgent` + `tenant-invitation.invitedBy` annotations now name the referenced user as their subject.

### Patch Changes

- Updated dependencies [b01a4d2]
- Updated dependencies [53da660]
- Updated dependencies [6ffb71e]
- Updated dependencies [02670c9]
  - @cosmicdrift/kumiko-framework@0.119.0
  - @cosmicdrift/kumiko-headless@0.119.0
  - @cosmicdrift/kumiko-renderer@0.119.0
  - @cosmicdrift/kumiko-dispatcher-live@0.119.0
  - @cosmicdrift/kumiko-renderer-web@0.119.0

## 0.118.0

### Patch Changes

- Updated dependencies [c5ed4f0]
  - @cosmicdrift/kumiko-framework@0.118.0
  - @cosmicdrift/kumiko-headless@0.118.0
  - @cosmicdrift/kumiko-renderer@0.118.0
  - @cosmicdrift/kumiko-dispatcher-live@0.118.0
  - @cosmicdrift/kumiko-renderer-web@0.118.0

## 0.117.0

### Minor Changes

- 03809b9: personal-access-tokens: add `toggleable` option so the whole feature can be tier-gated via the tier-engine (mirrors ledger/tags). Pass `{ toggleable: { default: false } }` for fail-closed gating — PAT is then off until a tier lists `"personal-access-tokens"` in its features. Omitting the option keeps PAT always-on (no behaviour change for existing consumers).

### Patch Changes

- Updated dependencies [e5bae38]
  - @cosmicdrift/kumiko-framework@0.117.0
  - @cosmicdrift/kumiko-headless@0.117.0
  - @cosmicdrift/kumiko-renderer@0.117.0
  - @cosmicdrift/kumiko-dispatcher-live@0.117.0
  - @cosmicdrift/kumiko-renderer-web@0.117.0

## 0.116.1

### Patch Changes

- Updated dependencies [c823f78]
  - @cosmicdrift/kumiko-renderer-web@0.116.1
  - @cosmicdrift/kumiko-framework@0.116.1
  - @cosmicdrift/kumiko-dispatcher-live@0.116.1
  - @cosmicdrift/kumiko-headless@0.116.1
  - @cosmicdrift/kumiko-renderer@0.116.1

## 0.116.0

### Minor Changes

- ef58e34: data-retention cleanup now implements the `anonymize` strategy (per-field anonymize functions applied via the event-store executor, idempotent — a re-run appends zero events) and completes `blockDelete`: rows stay untouched during the keepFor legal hold, after expiry the anonymize functions run (row stays, person link goes). `RunRetentionCleanupResult.anonymizeDeferred` is replaced by `anonymized: number`; entities with an anonymize/blockDelete policy but no anonymize-annotated fields are reported in `skipped` with reason `missing_anonymize_fields`.

### Patch Changes

- d9bb774: user-data-rights-defaults now registers EXT_USER_DATA export/delete hooks for six more bundled entities: user-session (ip/userAgent), api-token, in-app-message, tenant-invitation, notification-preference and user-scoped config-value. Hooks no-op when the source feature isn't mounted. pii annotations added on the affected schema fields.
- Updated dependencies [b82bf74]
  - @cosmicdrift/kumiko-renderer-web@0.116.0
  - @cosmicdrift/kumiko-framework@0.116.0
  - @cosmicdrift/kumiko-dispatcher-live@0.116.0
  - @cosmicdrift/kumiko-headless@0.116.0
  - @cosmicdrift/kumiko-renderer@0.116.0

## 0.115.1

### Patch Changes

- Updated dependencies [7054c74]
  - @cosmicdrift/kumiko-framework@0.115.1
  - @cosmicdrift/kumiko-headless@0.115.1
  - @cosmicdrift/kumiko-renderer@0.115.1
  - @cosmicdrift/kumiko-dispatcher-live@0.115.1
  - @cosmicdrift/kumiko-renderer-web@0.115.1

## 0.115.0

### Patch Changes

- Updated dependencies [a1a13ab]
  - @cosmicdrift/kumiko-renderer-web@0.115.0
  - @cosmicdrift/kumiko-framework@0.115.0
  - @cosmicdrift/kumiko-dispatcher-live@0.115.0
  - @cosmicdrift/kumiko-headless@0.115.0
  - @cosmicdrift/kumiko-renderer@0.115.0

## 0.114.0

### Patch Changes

- Updated dependencies [5b29c10]
  - @cosmicdrift/kumiko-renderer-web@0.114.0
  - @cosmicdrift/kumiko-framework@0.114.0
  - @cosmicdrift/kumiko-dispatcher-live@0.114.0
  - @cosmicdrift/kumiko-headless@0.114.0
  - @cosmicdrift/kumiko-renderer@0.114.0

## 0.113.1

### Patch Changes

- Updated dependencies [25b7e6e]
  - @cosmicdrift/kumiko-renderer@0.113.1
  - @cosmicdrift/kumiko-renderer-web@0.113.1
  - @cosmicdrift/kumiko-framework@0.113.1
  - @cosmicdrift/kumiko-dispatcher-live@0.113.1
  - @cosmicdrift/kumiko-headless@0.113.1

## 0.113.0

### Patch Changes

- Updated dependencies [ba5053b]
  - @cosmicdrift/kumiko-framework@0.113.0
  - @cosmicdrift/kumiko-renderer@0.113.0
  - @cosmicdrift/kumiko-headless@0.113.0
  - @cosmicdrift/kumiko-renderer-web@0.113.0
  - @cosmicdrift/kumiko-dispatcher-live@0.113.0

## 0.112.1

### Patch Changes

- Updated dependencies [0b9eb9a]
  - @cosmicdrift/kumiko-framework@0.112.1
  - @cosmicdrift/kumiko-headless@0.112.1
  - @cosmicdrift/kumiko-renderer@0.112.1
  - @cosmicdrift/kumiko-dispatcher-live@0.112.1
  - @cosmicdrift/kumiko-renderer-web@0.112.1

## 0.112.0

### Patch Changes

- Updated dependencies [3714822]
  - @cosmicdrift/kumiko-framework@0.112.0
  - @cosmicdrift/kumiko-headless@0.112.0
  - @cosmicdrift/kumiko-renderer@0.112.0
  - @cosmicdrift/kumiko-dispatcher-live@0.112.0
  - @cosmicdrift/kumiko-renderer-web@0.112.0

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

### Patch Changes

- Updated dependencies [340acef]
  - @cosmicdrift/kumiko-framework@0.111.0
  - @cosmicdrift/kumiko-headless@0.111.0
  - @cosmicdrift/kumiko-renderer@0.111.0
  - @cosmicdrift/kumiko-dispatcher-live@0.111.0
  - @cosmicdrift/kumiko-renderer-web@0.111.0

## 0.110.0

### Patch Changes

- Updated dependencies [3fa4673]
  - @cosmicdrift/kumiko-framework@0.110.0
  - @cosmicdrift/kumiko-headless@0.110.0
  - @cosmicdrift/kumiko-renderer@0.110.0
  - @cosmicdrift/kumiko-dispatcher-live@0.110.0
  - @cosmicdrift/kumiko-renderer-web@0.110.0

## 0.109.0

### Minor Changes

- b127293: Personal Access Tokens: two-axis scopes (which API × permission level).

  `PatScopeConfig` now maps each domain to `{ label, read[], write? }`; a token grants `"<domain>:<level>"` entries (e.g. `"credit:write"`) where `read` grants the read QNs and `write` grants read + write. The mount UI renders a per-domain level picker (no access / read / read & write) — mirrors GitHub fine-grained PATs. Supersedes the initial flat scope shape (no consumer had adopted it yet). The `personal-access-tokens` feature is now mounted in the `use-all-bundled` sample.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.109.0
- @cosmicdrift/kumiko-dispatcher-live@0.109.0
- @cosmicdrift/kumiko-headless@0.109.0
- @cosmicdrift/kumiko-renderer@0.109.0
- @cosmicdrift/kumiko-renderer-web@0.109.0

## 0.108.0

### Minor Changes

- d1b91b1: User-stream backfill tooling + removal of the dead pre-#497 probing (#762).

  - New `backfillUserStreamTenants(db)` (exported from the `user` feature): one-time migration that moves pre-#497 user event streams onto `SYSTEM_TENANT_ID`. Unlike the raw SQL documented in the #497 changeset it also merges split streams (legacy tenant + post-#497 SYSTEM events for the same aggregate) by renumbering versions in global event-id order, drops stale snapshots, and moves archived-stream markers. Idempotent, per-aggregate transactional, collects failures instead of aborting. Run once per existing deployment, then rebuild `user:projection:user-entity`.
  - Removed the scattered-stream workaround that stopped working when the #497 executor choke-point landed: `tryWriteAcrossTenants`/membership probing in the confirm-token flows, the `getAggregateStreamTenant` recovery in change-password/change-email, and the row-tenant rescope in `updateUserLifecycle`. All user writes now address `SYSTEM_TENANT_ID` directly.
  - confirm-token flows additionally reject rows without an event stream (`version < 1`) instead of seeding a fresh stream with a bare `user.updated`.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.108.0
- @cosmicdrift/kumiko-dispatcher-live@0.108.0
- @cosmicdrift/kumiko-headless@0.108.0
- @cosmicdrift/kumiko-renderer@0.108.0
- @cosmicdrift/kumiko-renderer-web@0.108.0

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

### Patch Changes

- Updated dependencies [64ff082]
- Updated dependencies [5ed5ad3]
- Updated dependencies [3ff6025]
  - @cosmicdrift/kumiko-framework@0.107.0
  - @cosmicdrift/kumiko-dispatcher-live@0.107.0
  - @cosmicdrift/kumiko-headless@0.107.0
  - @cosmicdrift/kumiko-renderer@0.107.0
  - @cosmicdrift/kumiko-renderer-web@0.107.0

## 0.106.0

### Minor Changes

- d6fbd00: Personal Access Tokens: long-lived, revocable bearer credentials for headless HTTP-API access.

  - New `personal-access-tokens` bundled-feature: `read_api_tokens` direct-write store, SHA-256 token hashing, show-once mint, `create`/`revoke`/`mine`/`available-scopes` handlers, and a mountable `PatTokensScreen` web UI (`personalAccessTokensClient()`).
  - Framework auth seam: bearer tokens prefixed `kpat_` resolve via a new `patResolver` (before jwt.verify) into a `SessionUser`; roles are resolved live per request (not snapshotted). Config-driven scopes (app declares named QN-glob bundles) are enforced fail-closed at the API boundary. Optional per-token rate limiting.
  - `runProdApp`/`runDevApp` auto-wire the resolver + rate limiter when the feature is mounted. All new `AuthRoutesConfig`/`SessionUser` fields are optional — no change for apps that don't mount it.

### Patch Changes

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

- Updated dependencies [7944923]
- Updated dependencies [d6fbd00]
  - @cosmicdrift/kumiko-framework@0.106.0
  - @cosmicdrift/kumiko-headless@0.106.0
  - @cosmicdrift/kumiko-renderer@0.106.0
  - @cosmicdrift/kumiko-dispatcher-live@0.106.0
  - @cosmicdrift/kumiko-renderer-web@0.106.0

## 0.105.2

### Patch Changes

- a305251: Export `template-resolver/seeding` (`seedSystemTemplate`) for app boot seeds.
- a305251: Add `userEmailBeforeDelete` to `UserDataHookCtx` so forget delete-hooks can match user-owned rows across every tenant pass before the user row is anonymized.
- Updated dependencies [a305251]
  - @cosmicdrift/kumiko-framework@0.105.2
  - @cosmicdrift/kumiko-headless@0.105.2
  - @cosmicdrift/kumiko-renderer@0.105.2
  - @cosmicdrift/kumiko-dispatcher-live@0.105.2
  - @cosmicdrift/kumiko-renderer-web@0.105.2

## 0.105.1

### Patch Changes

- 4f6e001: Export `template-resolver/seeding` (`seedSystemTemplate`) for app boot seeds.
  - @cosmicdrift/kumiko-framework@0.105.1
  - @cosmicdrift/kumiko-dispatcher-live@0.105.1
  - @cosmicdrift/kumiko-headless@0.105.1
  - @cosmicdrift/kumiko-renderer@0.105.1
  - @cosmicdrift/kumiko-renderer-web@0.105.1

## 0.105.0

### Patch Changes

- Updated dependencies [1918250]
  - @cosmicdrift/kumiko-framework@0.105.0
  - @cosmicdrift/kumiko-headless@0.105.0
  - @cosmicdrift/kumiko-renderer@0.105.0
  - @cosmicdrift/kumiko-dispatcher-live@0.105.0
  - @cosmicdrift/kumiko-renderer-web@0.105.0

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

### Patch Changes

- Updated dependencies [a3c973e]
  - @cosmicdrift/kumiko-framework@0.104.0
  - @cosmicdrift/kumiko-headless@0.104.0
  - @cosmicdrift/kumiko-renderer@0.104.0
  - @cosmicdrift/kumiko-dispatcher-live@0.104.0
  - @cosmicdrift/kumiko-renderer-web@0.104.0

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

### Patch Changes

- Updated dependencies [961d0bb]
  - @cosmicdrift/kumiko-framework@0.103.0
  - @cosmicdrift/kumiko-headless@0.103.0
  - @cosmicdrift/kumiko-renderer@0.103.0
  - @cosmicdrift/kumiko-dispatcher-live@0.103.0
  - @cosmicdrift/kumiko-renderer-web@0.103.0

## 0.102.2

### Patch Changes

- Updated dependencies [cfc5895]
  - @cosmicdrift/kumiko-headless@0.102.2
  - @cosmicdrift/kumiko-dispatcher-live@0.102.2
  - @cosmicdrift/kumiko-renderer@0.102.2
  - @cosmicdrift/kumiko-renderer-web@0.102.2
  - @cosmicdrift/kumiko-framework@0.102.2

## 0.102.1

### Patch Changes

- Updated dependencies [e0b88c7]
  - @cosmicdrift/kumiko-headless@0.102.1
  - @cosmicdrift/kumiko-dispatcher-live@0.102.1
  - @cosmicdrift/kumiko-renderer@0.102.1
  - @cosmicdrift/kumiko-renderer-web@0.102.1
  - @cosmicdrift/kumiko-framework@0.102.1

## 0.102.0

### Minor Changes

- 020d5e8: delivery: decouple email rendering into chained jobs + map notify priority onto the job queue (#267)

  - **Framework:** job handlers now receive the `jobRunner` on their context, so a job can dispatch a follow-up job (job→job chaining). `jobRunner.dispatch` accepts `meta.priority` and forwards it as the BullMQ job priority.
  - **delivery:** queued-mode channels (email, push) now deliver asynchronously. Email runs through `delivery.render` → `delivery.send` so the expensive render step is isolated in its own worker and retries independently of the SMTP send; push (no render step) goes straight to `delivery.send`. inApp stays inline (DB insert + SSE). Without a `jobRunner` configured, queued channels fall back to synchronous inline delivery.
  - **delivery:** `notify()` `priority` (`critical`/`normal`/`low`) now maps onto the BullMQ job priority (1/2/3), so critical notifications jump ahead of low-priority ones in the worker queue.
  - **delivery:** `read_delivery_attempts` gains a `priority` column and a `queued` status; an async attempt transitions `queued` → `sent`/`failed` on one event stream.

### Patch Changes

- Updated dependencies [4659e52]
- Updated dependencies [020d5e8]
  - @cosmicdrift/kumiko-headless@0.102.0
  - @cosmicdrift/kumiko-framework@0.102.0
  - @cosmicdrift/kumiko-dispatcher-live@0.102.0
  - @cosmicdrift/kumiko-renderer@0.102.0
  - @cosmicdrift/kumiko-renderer-web@0.102.0

## 0.101.0

### Minor Changes

- a32f591: App-shell hoist (boot-wiring + presets): less per-app bootstrap duplication

  `runProdApp` now provides framework defaults that apps override only for the exception:

  - Auto-wires `textContent` (always) and `secrets` (when the `secrets` feature is mounted) into the AppContext — apps drop their hand-rolled extraContext factory. New optional `masterKey?` override for KMS backends instead of the env KEK provider.
  - New `auth.mail` block builds all four auth-mail flows (password-reset, email-verification, signup, invite) from an env-derived SMTP transport + standard templates, replacing the per-app SMTP block + `createAuthMailerConfig` wrapper + `AUTH_PATHS` plucking. Null-transport guard preserved (no `SMTP_HOST` → flows stay unwired); explicit per-flow setups still win.

  New helpers:

  - `createSmtpTransportFromEnv(env, { fallbackFrom })` (channel-email).
  - `seedLegalContentFromJson(db, blocks)` (text-content) — centralises the legal-block seed loop with the load-bearing `ifExists: "update"`.
  - `dsgvoSelfServiceFeatures(opts?)` (new `presets` entry) — the five-feature DSGVO + account-self-service chain in dependency order.
  - `DEFAULT_AUTH_PATHS` + `makeAuthPaths()`; `createAuthMailerConfig`'s `paths` argument is now optional (defaults to `DEFAULT_AUTH_PATHS`).
  - `SECRETS_FEATURE_NAME` constant.

  Additive and backward-compatible — existing apps that pass explicit wiring keep working unchanged.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.101.0
- @cosmicdrift/kumiko-dispatcher-live@0.101.0
- @cosmicdrift/kumiko-headless@0.101.0
- @cosmicdrift/kumiko-renderer@0.101.0
- @cosmicdrift/kumiko-renderer-web@0.101.0

## 0.100.0

### Patch Changes

- Updated dependencies [aaf890e]
- Updated dependencies [17b44b3]
  - @cosmicdrift/kumiko-framework@0.100.0
  - @cosmicdrift/kumiko-headless@0.100.0
  - @cosmicdrift/kumiko-renderer@0.100.0
  - @cosmicdrift/kumiko-dispatcher-live@0.100.0
  - @cosmicdrift/kumiko-renderer-web@0.100.0

## 0.99.0

### Minor Changes

- 8146e5b: tags + renderer: inline tag chips on list rows, via a reusable component column

  - **renderer**: an `entityList` column can now be a _virtual labeled column_ — a presentational column drawn entirely by a `columnRenderer` component from the row, not tied to an entity field. Declare `{ field, label, renderer: { react: { __component } } }`; the new `label` also overrides any column's header (i18n key or literal). Any feature can now build component columns — tag chips, status badges, avatars — not just string formatters.
  - **tags**: new `TagsCell` column renderer (registered via `tagsClient().columnRenderers`) shows an entity's tags as colored chips inline in any list row. Drop `{ field: "tags", label: "Tags", renderer: { react: { __component: TAGS_COLUMN_RENDERER_NAME } } }` into any `entityList` — no host-schema change.
  - **tags**: `TagFilter` now shows the active selection as colored chips with a clear button, instead of just a count, so the active filter is visible.

### Patch Changes

- Updated dependencies [8146e5b]
  - @cosmicdrift/kumiko-framework@0.99.0
  - @cosmicdrift/kumiko-headless@0.99.0
  - @cosmicdrift/kumiko-renderer@0.99.0
  - @cosmicdrift/kumiko-dispatcher-live@0.99.0
  - @cosmicdrift/kumiko-renderer-web@0.99.0

## 0.98.0

### Minor Changes

- 4c39e11: tags: production-ready, GitLab-style labels

  - **Colored tags**: a tag's `color` now renders as a contrast-aware chip (`TagChip`, YIQ black/white text), plus a read-only `EntityTags` chip row for cards and detail views.
  - **Shared management UI**: new `TagManager` (catalog CRUD with per-tag usage counts) is mounted both as a standalone `tag-list` management screen and inside a `TagPicker` modal that returns the picked tags to the caller.
  - **Edit + delete**: new `tags:write:update-tag` (optimistic-locked rename / recolor / re-scope) and `tags:write:delete-tag` (cascades over the tag's assignments) handlers.
  - **Optional scope**: a tag carries an optional `scope` (empty = global, or an entity type) — GitLab group-vs-project label parity; the picker only offers global + scope-matching tags.
  - **Drop-in filtering**: `TagSection` (assign/manage on any entity edit) and a `TagFilter` header-slot control that narrows any `entityList` to the rows carrying the picked tags — no host-schema change.
  - **BREAKING**: `tags:write:rename-tag` is removed; use `tags:write:update-tag` (a superset that also updates color and scope).

  renderer: `entityList` faceted filters now accept the base `id` column (operator `in`), and list header-slot components receive the list's `screenId`. Together these let a header control drive the list's url-filter state — the enabling change for the tags `TagFilter` drop-in.

### Patch Changes

- Updated dependencies [4c39e11]
  - @cosmicdrift/kumiko-renderer@0.98.0
  - @cosmicdrift/kumiko-renderer-web@0.98.0
  - @cosmicdrift/kumiko-framework@0.98.0
  - @cosmicdrift/kumiko-dispatcher-live@0.98.0
  - @cosmicdrift/kumiko-headless@0.98.0

## 0.97.1

### Patch Changes

- Updated dependencies [c5410a3]
  - @cosmicdrift/kumiko-framework@0.97.1
  - @cosmicdrift/kumiko-headless@0.97.1
  - @cosmicdrift/kumiko-renderer@0.97.1
  - @cosmicdrift/kumiko-dispatcher-live@0.97.1
  - @cosmicdrift/kumiko-renderer-web@0.97.1

## 0.97.0

### Patch Changes

- Updated dependencies [4e2bd72]
  - @cosmicdrift/kumiko-framework@0.97.0
  - @cosmicdrift/kumiko-headless@0.97.0
  - @cosmicdrift/kumiko-renderer@0.97.0
  - @cosmicdrift/kumiko-dispatcher-live@0.97.0
  - @cosmicdrift/kumiko-renderer-web@0.97.0

## 0.96.0

### Minor Changes

- 38ed5f4: ledger: add a client-safe `@cosmicdrift/kumiko-bundled-features/ledger/web` entry exporting the QN constants (`LedgerHandlers`/`LedgerQueries`) plus the pure recurring helpers (`projectSchedule`, `mergeScheduleActuals`, `scheduleReference`) and types. The main `/ledger` entry re-exports the feature/handlers/executor (which pull bun-db/postgres), so a browser bundle that imported from there failed on Node builtins. Client screens (e.g. a rent-cashflow view) import the dispatch QNs + forecast/merge from `/ledger/web` and dispatch via the renderer — mirrors `/folders/web`.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.96.0
- @cosmicdrift/kumiko-dispatcher-live@0.96.0
- @cosmicdrift/kumiko-headless@0.96.0
- @cosmicdrift/kumiko-renderer@0.96.0
- @cosmicdrift/kumiko-renderer-web@0.96.0

## 0.95.0

### Minor Changes

- 23527e4: FolderManager: per-leaf `entityType` override so a single filing tree can hold leaves of mixed entity types (e.g. credits + Bausparverträge), each filed/cleared under its own type. `FolderLeaf.entityType` is optional and defaults to `filing.entityType`, so existing single-type callers are unaffected.
- a236ed7: ledger: recurring schedules (Dauerauftrag) layered on the double-entry primitive. A `schedule` entity (debit/credit accounts, amount, monthly interval) yields the Soll as a pure projection (`projectSchedule`) that needs no bookings, while `confirm-schedule-period` materialises one period as an idempotent, reversal-aware balanced entry referencing `scheduleReference(id, period)`. `mergeScheduleActuals` merges Soll vs. Ist (posted | open | forecast), with a stornoed month dropping back to open + re-confirmable. Forecast without booking every month; only confirming writes.

### Patch Changes

- Updated dependencies [387f259]
- Updated dependencies [da32b71]
  - @cosmicdrift/kumiko-framework@0.95.0
  - @cosmicdrift/kumiko-headless@0.95.0
  - @cosmicdrift/kumiko-renderer@0.95.0
  - @cosmicdrift/kumiko-dispatcher-live@0.95.0
  - @cosmicdrift/kumiko-renderer-web@0.95.0

## 0.94.0

### Patch Changes

- Updated dependencies [31a2abf]
  - @cosmicdrift/kumiko-framework@0.94.0
  - @cosmicdrift/kumiko-headless@0.94.0
  - @cosmicdrift/kumiko-renderer@0.94.0
  - @cosmicdrift/kumiko-dispatcher-live@0.94.0
  - @cosmicdrift/kumiko-renderer-web@0.94.0

## 0.93.0

### Patch Changes

- Updated dependencies [37d0ea4]
  - @cosmicdrift/kumiko-framework@0.93.0
  - @cosmicdrift/kumiko-headless@0.93.0
  - @cosmicdrift/kumiko-renderer@0.93.0
  - @cosmicdrift/kumiko-dispatcher-live@0.93.0
  - @cosmicdrift/kumiko-renderer-web@0.93.0

## 0.92.0

### Minor Changes

- 6514695: feat(folders): drag-and-drop filing in FolderManager

  `FolderManager` gains an opt-in `filing` mode: a host hands in its entities
  (grouped by folder + an unfiled bucket via `FolderLeaf`/`FolderFiling`) and the
  manager interleaves them as draggable leaf rows. Drag a leaf onto a folder to
  file it (set-folder), onto the unfiled bucket to unfile it (clear-folder); the
  manager owns the reassignment writes + its catalog refetch and calls the host's
  `onReassigned` to refresh assignment-derived data. Without `filing` the manager
  renders exactly as before (folder management only). Guide rails are now gapless
  (padding-free `min-h-9` rows) for every host.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.92.0
- @cosmicdrift/kumiko-dispatcher-live@0.92.0
- @cosmicdrift/kumiko-headless@0.92.0
- @cosmicdrift/kumiko-renderer@0.92.0
- @cosmicdrift/kumiko-renderer-web@0.92.0

## 0.91.0

### Minor Changes

- 30d03de: feat(ledger): double-entry bookkeeping primitive

  New `ledger` bundled feature — a host-agnostic double-entry primitive. Owns the
  per-tenant `account` chart of accounts and immutable `transaction` journal
  entries (balanced posting lines, Σ = 0, signed integer minor units; corrections
  via reverse-transaction Storno, no update/delete). Account balances, P&L, and
  balance sheet derive as pure queries over the postings. Mount with
  `createLedgerFeature({ roles | access, toggleable })`. Ships `ledger-banking`
  and `ledger-invoicing` sample recipes.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.91.0
- @cosmicdrift/kumiko-dispatcher-live@0.91.0
- @cosmicdrift/kumiko-headless@0.91.0
- @cosmicdrift/kumiko-renderer@0.91.0
- @cosmicdrift/kumiko-renderer-web@0.91.0

## 0.90.3

### Patch Changes

- @cosmicdrift/kumiko-framework@0.90.3
- @cosmicdrift/kumiko-dispatcher-live@0.90.3
- @cosmicdrift/kumiko-headless@0.90.3
- @cosmicdrift/kumiko-renderer@0.90.3
- @cosmicdrift/kumiko-renderer-web@0.90.3

## 0.90.2

### Patch Changes

- 5f623a9: docs(user-data-rights): note the zero-callback mail defaults in the feature description

  `user-data-rights`'s `r.describe()` now states that, with `mail-foundation` + a
  `mail-transport-*` mounted, the feature sends the four GDPR notifications itself
  (no app callback code, rendered in the recipient's locale) — so the generated
  feature-reference page reflects the C6 mail defaults. `feature-manifest.json`
  regenerated accordingly.

  - @cosmicdrift/kumiko-framework@0.90.2
  - @cosmicdrift/kumiko-dispatcher-live@0.90.2
  - @cosmicdrift/kumiko-headless@0.90.2
  - @cosmicdrift/kumiko-renderer@0.90.2
  - @cosmicdrift/kumiko-renderer-web@0.90.2

## 0.90.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.90.1
- @cosmicdrift/kumiko-dispatcher-live@0.90.1
- @cosmicdrift/kumiko-headless@0.90.1
- @cosmicdrift/kumiko-renderer@0.90.1
- @cosmicdrift/kumiko-renderer-web@0.90.1

## 0.90.0

### Minor Changes

- 1712768: Add `folders` — a generic, host-agnostic hierarchical folder feature for filing any entity into a nested tree where each entity lives in exactly **one** folder (re-assign = move). Mirrors `tags` but with two differences: a `folder` carries a nullable `parentId` (the tree), and the `folder-assignment` aggregate-id is keyed on `(tenantId, entityType, entityId)` **without** the folderId, so there is exactly one membership row per entity.

  - `@cosmicdrift/kumiko-bundled-features/folders` — entities (`folder`, `folder-assignment`), catalog CRUD via the generic entity handlers, plus hand-written `set-folder` (upsert/move) and `clear-folder` (softDelete) write handlers.
  - `@cosmicdrift/kumiko-bundled-features/folders/web` — `FolderManager` (in-screen Finder-style tree: create/rename/delete/subfolder, KPI-agnostic via a `renderMeta` render-prop), `FolderSection` (single-folder form picker via `extensionSectionComponents`), `foldersClient()`, and the pure `buildFolderTree` / `folderPath` tree helpers.
  - `@cosmicdrift/kumiko-bundled-features/folders-user-data` — `EXT_USER_DATA` export/delete hooks for `folder` + `folder-assignment` so folder data is included in the GDPR (Art. 20 export / Art. 17 forget) pipeline. It hard-requires `user-data-rights` and `optionalRequires("folders")`, so it activates whenever `folders` is mounted (including tier-gated `toggleable` mounts) without emitting an "effectively disabled" boot warning.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.90.0
- @cosmicdrift/kumiko-dispatcher-live@0.90.0
- @cosmicdrift/kumiko-headless@0.90.0
- @cosmicdrift/kumiko-renderer@0.90.0
- @cosmicdrift/kumiko-renderer-web@0.90.0

## 0.89.0

### Minor Changes

- be41f4d: feat(user-data-rights): zero-callback GDPR emails via mail-foundation (C6)

  `user-data-rights` now ships default `send*Email` implementations + email
  templates for the four GDPR notifications (export-ready, export-failed,
  deletion-requested, deletion-executed). Mount `mail-foundation` + any
  `mail-transport-*` (e.g. `mail-transport-smtp`) and the feature sends these
  mails itself — no app callback code. An app that passes its own `send*Email`
  opt keeps full control (the default only fills the gap). The default mails
  render in the recipient's own `user.locale` (de/en); `mailDefaults`
  (`{ locale, appName }`) brands them and supplies the locale fallback for
  unknown/unsupported values. Export-ready additionally needs
  `appExportDownloadUrl` (a one-shot operator warning fires if a transport is
  mounted but the URL is unset).

  The four `send*Email` callback args gain a `userLocale` field (additive — apps
  with their own callbacks may ignore it).

  The job-lane crons (export/forget) reach the per-tenant transport through a new
  `makeTenantMailTransportResolver`, mirroring the file-provider resolver: the
  cron ctx carries `configResolver` (the per-request `ConfigAccessor` exists only
  in the HTTP dispatcher), so the resolver builds a per-tenant accessor from it.
  The deletion-requested mail runs in the request lane and uses the request ctx
  directly. The anonymous-flow verification mail stays app-wired by design — a
  synchronous default would reintroduce an account-enumeration timing oracle.

  **Plugin-author-facing change:** `MailTransportPlugin.build(ctx, tenantId)` and
  `createTransportForTenant(ctx, tenantId)` now take a narrow `MailTransportContext`
  (`{ config?, registry?, secrets?, _userId? }`) instead of the full
  `HandlerContext`, mirroring file-foundation's `FileProviderContext`. The full
  `HandlerContext` from the request lane is still assignable, so request-path
  callers are unaffected; custom `mail-transport-*` plugins that annotated
  `build(ctx: HandlerContext)` should switch to `MailTransportContext`. This also
  fixes a latent worker-lane crash: the previous `HandlerContext` typing invited a
  synthetic-ctx cast that would have read request-only fields absent in the cron
  lane.

- 8ae9ca3: feat(data-retention): autonomous retention-cleanup cron (GDPR C7)

  `data-retention` now registers a `retention-cleanup` cron (perTenant fan-out,
  daily) that autonomously enforces configured retention policies — previously
  rules were resolved but never executed. For each implicit entity projection it
  resolves the effective policy (entity-default → compliance-profile-derived
  preset → per-tenant override) and applies the strategy to rows past their
  `keepFor` cutoff:

  - **hardDelete** — batched delete (`deleteManyBatched`, no full-table scans)
  - **softDelete** — `isDeleted`/`deletedAt`, only on not-yet-deleted rows
  - **blockDelete** — ignored by design (the user-forget flow anonymizes instead)
  - **anonymize** — deferred (needs an idempotency marker; no bundled entity uses
    time-driven anonymize, and the forget flow covers userId-keyed anonymize)

  The Layer-2 preset is derived from the tenant's compliance profile when
  `compliance-profiles` is mounted (soft-dependency, no `r.requires`), so mounting
  both features cleans data with no app code.

  Two latent silent-no-op bugs surfaced and fixed as the first real consumer of
  `retention.reference`:

  - The boot-validator allows `createdAt`/`updatedAt` as retention references, but
    the physical columns are `inserted_at`/`modified_at`. The cleanup runner now
    maps these framework-timestamp aliases to the real columns.
  - The `dsgvo-*` presets keyed entities `auditLog`/`httpLog` (camelCase) against
    the file's own kebab-case convention; renamed to `audit-log`/`http-log`.

  A missing reference column is skipped (not mass-deleted) and reported for
  operator visibility.

### Patch Changes

- ca33c52: HTTP-cache hardening + load reduction for the public-page caches (follow-up to the cache helpers in #630).

  - **`cachedResponse`: `If-None-Match` now decides alone.** Per RFC 7232 §3.3 a present `If-None-Match` makes `If-Modified-Since` irrelevant. Previously a mismatching ETag fell through to the `If-Modified-Since` branch and could still return a stale `304`. Benign in the current call sites (static ETags are mtime+size based, revision routes carry no `last-modified`), but now correct: ETag present → ETag alone.
  - **Multi-tenant `index.html` is served with `Vary: Host`.** `runProdApp`'s `hostDispatch` path picks the HTML file per Host and serves it `public`. Without `Vary: Host` a shared cache could key only on the URL; only the `max-age=0, must-revalidate` + per-Host ETag kept it from leaking one tenant's schema-injected shell to another. `Vary: Host` makes the isolation explicit instead of incidental, matching `managed-pages`.
  - **`legal-pages` / `managed-pages` cache for 60s.** Both served `public, max-age=0, must-revalidate`, so every request hit the origin to revalidate — and each `304` re-ran the content (and branding) query just to recompute the revision ETag. They now use `public, max-age=60, must-revalidate`: CDN/browser serve fresh for 60s without an origin round-trip, edits go live within 60s.

- Updated dependencies [ca33c52]
- Updated dependencies [dbc2c2d]
- Updated dependencies [4722d4e]
  - @cosmicdrift/kumiko-framework@0.89.0
  - @cosmicdrift/kumiko-renderer@0.89.0
  - @cosmicdrift/kumiko-headless@0.89.0
  - @cosmicdrift/kumiko-renderer-web@0.89.0
  - @cosmicdrift/kumiko-dispatcher-live@0.89.0

## 0.88.0

### Minor Changes

- 3ccc55e: Add read-only operator inspector screens to the `user-data-rights` feature: SystemAdmin-gated `entityList` + read-only `entityEdit` screens over the GDPR `export-job` (list + detail) and `download-attempt` (list) read-models, plus the convention `:list`/`:detail` query handlers so they resolve by QN. The screens are inert until an app navs them (opt-in at wire time). Because both entities are event-sourced `r.entity` rows, binding `entityList` is rebuild-safe — direct-write read-models like `jobs`/`sessions` still need a separate query-bound primitive (follow-up).

### Patch Changes

- @cosmicdrift/kumiko-framework@0.88.0
- @cosmicdrift/kumiko-dispatcher-live@0.88.0
- @cosmicdrift/kumiko-headless@0.88.0
- @cosmicdrift/kumiko-renderer@0.88.0
- @cosmicdrift/kumiko-renderer-web@0.88.0

## 0.87.3

### Patch Changes

- 070c032: Add a read-time backstop against reserved tenant-membership roles. The write paths already reject `system`/`SystemAdmin`/`all`/`anonymous` from memberships at command time, but command-time validation does not survive an event-sourcing projection rebuild: replaying a stored `tenant-membership.created` event goes through the apply path, not the handler, so a membership role that was forbidden when written could be resurrected into the projection.

  `stripForbiddenMembershipRoles` (new, exported from `@cosmicdrift/kumiko-framework/engine`) filters reserved roles out of the membership portion at every JWT mint that derives roles from a membership — login, switch-tenant, invite-accept, and invite-signup-complete. `globalRoles` (where `SystemAdmin` legitimately lives) is never filtered, so real platform admins are unaffected. The forbidden-role set is now the single source of truth in the engine; `bundled-features` re-exports `findForbiddenMembershipRole` from it.

- Updated dependencies [070c032]
  - @cosmicdrift/kumiko-framework@0.87.3
  - @cosmicdrift/kumiko-headless@0.87.3
  - @cosmicdrift/kumiko-renderer@0.87.3
  - @cosmicdrift/kumiko-dispatcher-live@0.87.3
  - @cosmicdrift/kumiko-renderer-web@0.87.3

## 0.87.2

### Patch Changes

- b04ca86: Fix tenant privilege escalation via membership roles. `hasAccess` checks session roles flat with no notion of origin, so a platform-global role (`SystemAdmin`/`system`) landing in a tenant membership merged into the session and unlocked the SystemAdmin-gated, cross-tenant handler surface — a Tenant-Admin could invite `SystemAdmin` and the invitee gained platform-wide, cross-tenant access.

  Reject reserved/global roles (`system`, `SystemAdmin`, `all`, `anonymous`) at every tenant-membership write chokepoint: `seedTenantMembership` (covers the three invite-accept branches plus seeding), `add-member`, `update-member-roles`, and early in `invite-create`. The bootstrap path was already correct (SystemAdmin lives in global `users.roles`, never in a membership); this makes the invite path consistent.

  Also centralize the `tenantIdOverride` SystemAdmin gate into a new `crossTenantOverrideDenied` helper (exported from `@cosmicdrift/kumiko-framework/engine`), replacing the inline check duplicated across managed-pages, compliance-profiles, text-content and template-resolver so a future override handler can't skip it.

- Updated dependencies [b04ca86]
  - @cosmicdrift/kumiko-framework@0.87.2
  - @cosmicdrift/kumiko-dispatcher-live@0.87.2
  - @cosmicdrift/kumiko-headless@0.87.2
  - @cosmicdrift/kumiko-renderer@0.87.2
  - @cosmicdrift/kumiko-renderer-web@0.87.2

## 0.87.1

### Patch Changes

- cb2abcd: Session bootstrap only mounts behind SessionAuthGate so public SPA gates (e.g. `/rechner`) no longer call `/api/auth/tenants`. Skip refresh when no `kumiko_csrf` cookie is present.
- Updated dependencies [cb2abcd]
  - @cosmicdrift/kumiko-framework@0.87.1
  - @cosmicdrift/kumiko-renderer-web@0.87.1
  - @cosmicdrift/kumiko-renderer@0.87.1
  - @cosmicdrift/kumiko-headless@0.87.1
  - @cosmicdrift/kumiko-dispatcher-live@0.87.1

## 0.87.0

### Minor Changes

- c0cbfb5: Add HTTP cache helpers (`cachedResponse`, ETag computation, `CachePolicy`) to `@cosmicdrift/kumiko-framework/api` and wire them into prod static-fallback plus `legal-pages` / `managed-pages` public HTML routes.

### Patch Changes

- Updated dependencies [c0cbfb5]
  - @cosmicdrift/kumiko-framework@0.87.0
  - @cosmicdrift/kumiko-headless@0.87.0
  - @cosmicdrift/kumiko-renderer@0.87.0
  - @cosmicdrift/kumiko-dispatcher-live@0.87.0
  - @cosmicdrift/kumiko-renderer-web@0.87.0

## 0.86.0

### Patch Changes

- Updated dependencies [0a80617]
  - @cosmicdrift/kumiko-framework@0.86.0
  - @cosmicdrift/kumiko-headless@0.86.0
  - @cosmicdrift/kumiko-renderer@0.86.0
  - @cosmicdrift/kumiko-dispatcher-live@0.86.0
  - @cosmicdrift/kumiko-renderer-web@0.86.0

## 0.85.0

### Patch Changes

- Updated dependencies [2cdfe9d]
  - @cosmicdrift/kumiko-headless@0.85.0
  - @cosmicdrift/kumiko-dispatcher-live@0.85.0
  - @cosmicdrift/kumiko-renderer@0.85.0
  - @cosmicdrift/kumiko-renderer-web@0.85.0
  - @cosmicdrift/kumiko-framework@0.85.0

## 0.84.0

### Patch Changes

- Updated dependencies [189f0cb]
  - @cosmicdrift/kumiko-framework@0.84.0
  - @cosmicdrift/kumiko-headless@0.84.0
  - @cosmicdrift/kumiko-renderer@0.84.0
  - @cosmicdrift/kumiko-dispatcher-live@0.84.0
  - @cosmicdrift/kumiko-renderer-web@0.84.0

## 0.83.0

### Minor Changes

- e36a2b0: GDPR forget (Art. 17): configurable tenant-occupancy model for tenant-scoped contributors.

  A tenant-scoped contributor with no per-user column (e.g. credit) can now erase a forgotten user's data when the app runs one user per tenant. The `user-data-rights` feature exposes a system-scoped `tenantModel` config (`"single-user" | "multi-user"`, default `"multi-user"`); the forget pipeline refines it **per tenant** with a runtime sole-member check and hands the effective model to each delete-hook via `ctx.tenantModel`. A stray invite that makes the `"single-user"` claim false at runtime downgrades to `"multi-user"`, so a co-member's data is never deleted on a per-user forget. Default `"multi-user"` preserves the existing safe no-op behaviour. New public type `TenantUserModel`.

### Patch Changes

- Updated dependencies [c2b7154]
- Updated dependencies [e36a2b0]
  - @cosmicdrift/kumiko-framework@0.83.0
  - @cosmicdrift/kumiko-renderer@0.83.0
  - @cosmicdrift/kumiko-headless@0.83.0
  - @cosmicdrift/kumiko-renderer-web@0.83.0
  - @cosmicdrift/kumiko-dispatcher-live@0.83.0

## 0.82.0

### Minor Changes

- 505f67c: tags: add a `rename-tag` write-handler so tag catalogs are editable.

  `tags:write:rename-tag` takes `{ id, version, name }` and renames a tag in the
  tenant's catalog. It is optimistic-locked (the client sends the `version` it
  read, mirroring `tenant:update`) and merges shallowly, so `color` is preserved.
  Stale version → `version_conflict` (409); cross-tenant → `not_found` (404).
  Exposed as `TagsHandlers.renameTag` + `renameTagPayloadSchema`. Delete-tag stays
  deferred.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.82.0
- @cosmicdrift/kumiko-dispatcher-live@0.82.0
- @cosmicdrift/kumiko-headless@0.82.0
- @cosmicdrift/kumiko-renderer@0.82.0
- @cosmicdrift/kumiko-renderer-web@0.82.0

## 0.81.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.81.1
- @cosmicdrift/kumiko-dispatcher-live@0.81.1
- @cosmicdrift/kumiko-headless@0.81.1
- @cosmicdrift/kumiko-renderer@0.81.1
- @cosmicdrift/kumiko-renderer-web@0.81.1

## 0.81.0

### Minor Changes

- cf4d208: GDPR/DSGVO storage is now wire-into-any-app-clean: an app gets a working,
  restart-surviving export + autonomous erasure by mounting + configuring, with a
  boot guard that catches the misconfiguration we shipped to prod (ephemeral
  export store → download 500 after a pod restart).

  - **`file-provider-s3-env` (new bundled feature)** — registers an `"s3-env"`
    file provider that reads one S3 credential set from `process.env`
    (`S3_BUCKET`/`S3_REGION`/`S3_ACCESS_KEY`/`S3_SECRET_KEY`, optional
    `S3_ENDPOINT`/`S3_FORCE_PATH_STYLE`) and serves every tenant from one shared
    bucket — no per-tenant config or secret seeding. The single-bucket /
    Hetzner-Object-Storage deploy path. Use `file-provider-s3` instead when each
    tenant needs its own bucket. Tenant isolation holds via tenant-prefixed
    export keys + UUID fileRef keys.
  - **Autonomous Art. 17 forget-cron** — `user-data-rights` now schedules
    `run-forget-cleanup` as a cron (mirroring the export cron). Deletion requests
    no longer sit in `DeletionRequested` forever; erasure runs unattended after
    the grace period. The manual `runForget` API stays for operator runs.
  - **Forget binary-delete resolves through file-foundation** — the `fileRef`
    delete hook now resolves the storage provider per-tenant from the mounted
    file-foundation at run time (injected via `ctx.buildStorageProvider`), the
    same path the export cron uses — so erasure deletes binaries from the same
    store uploads/export use (delete-target == upload-target by construction).
    **BREAKING:** `createUserDataRightsDefaultsFeature` no longer takes a
    `{ storageProvider }` option, and `createFileRefDeleteHook` is removed. Mount
    file-foundation + a `file-provider-*` feature instead; the hook wires itself.
  - **V1 boot guard** — `validateBoot` now WARNs when `user-data-rights` is
    mounted but no persistent file provider is (GDPR exports would be lost on
    restart), and when `s3-env` is the sole GDPR store but its `S3_*` env vars
    are unset (the provider would otherwise throw lazily on the first export).

### Patch Changes

- @cosmicdrift/kumiko-framework@0.81.0
- @cosmicdrift/kumiko-dispatcher-live@0.81.0
- @cosmicdrift/kumiko-headless@0.81.0
- @cosmicdrift/kumiko-renderer@0.81.0
- @cosmicdrift/kumiko-renderer-web@0.81.0

## 0.80.0

### Minor Changes

- 407ed37: Add a single `Card` primitive (slot- + options-based) and route all card chrome through it.

  `usePrimitives().Card` takes `slots` (`header`/`title`/`subtitle`/`headerActions`/`footer`) and `options` (`padded`/`radius`/`footerBordered`). `DefaultForm` and `DefaultSection` now render through `DefaultCard`, so every consumer gets one consistent chrome (border, radius, shadow, footer row) without re-migrating. `AuthCard` and the `user-data-rights` / `user-profile` self-service screens use it; action buttons live in the card footer. testIds are preserved.

### Patch Changes

- Updated dependencies [407ed37]
  - @cosmicdrift/kumiko-renderer@0.80.0
  - @cosmicdrift/kumiko-renderer-web@0.80.0
  - @cosmicdrift/kumiko-framework@0.80.0
  - @cosmicdrift/kumiko-dispatcher-live@0.80.0
  - @cosmicdrift/kumiko-headless@0.80.0

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

- Updated dependencies [cd34ef3]
  - @cosmicdrift/kumiko-renderer-web@0.79.3
  - @cosmicdrift/kumiko-framework@0.79.3
  - @cosmicdrift/kumiko-headless@0.79.3
  - @cosmicdrift/kumiko-renderer@0.79.3
  - @cosmicdrift/kumiko-dispatcher-live@0.79.3

## 0.79.2

### Patch Changes

- 914e84b: Fix: the data-export cron job (`run-export-jobs`) read `ctx.config` (a per-request ConfigAccessor that only the HTTP dispatcher builds), so in the cron-job context it was always undefined → `createFileProviderForTenant` threw "ctx.config is missing" and every export landed on `failed`. The r.job wrapper now builds the per-tenant ConfigAccessor from `ctx.configResolver` (which the job context does carry, like soft-delete-cleanup uses), mirroring the HTTP path's `_configAccessorFactory`. New integration test drives the real registered cron handler through its job context (red before, green after) — the existing test passed a manual provider and never exercised this path.
- Updated dependencies [335ffef]
  - @cosmicdrift/kumiko-framework@0.79.2
  - @cosmicdrift/kumiko-headless@0.79.2
  - @cosmicdrift/kumiko-renderer@0.79.2
  - @cosmicdrift/kumiko-dispatcher-live@0.79.2
  - @cosmicdrift/kumiko-renderer-web@0.79.2

## 0.79.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.79.1
- @cosmicdrift/kumiko-dispatcher-live@0.79.1
- @cosmicdrift/kumiko-headless@0.79.1
- @cosmicdrift/kumiko-renderer@0.79.1
- @cosmicdrift/kumiko-renderer-web@0.79.1

## 0.79.0

### Minor Changes

- 969f006: privacy-center UX polish:
  - Removed the activity-log (Art. 15) section — it showed raw event-type names with no useful detail; the data export already covers Art. 15.
  - Sections now use the `<Section>` primitive (consistent card optic + shadow) instead of hand-rolled card divs.
  - Export section auto-polls the status while a job is pending/running, so the download link appears without a manual reload.
  - New `userDataRightsClient({ privacyCenter: { showDeletion: false } })` option hides the deletion section — for apps that already offer account deletion elsewhere (e.g. a profile danger zone), to avoid duplication.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.79.0
- @cosmicdrift/kumiko-dispatcher-live@0.79.0
- @cosmicdrift/kumiko-headless@0.79.0
- @cosmicdrift/kumiko-renderer@0.79.0
- @cosmicdrift/kumiko-renderer-web@0.79.0

## 0.78.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.78.0
- @cosmicdrift/kumiko-dispatcher-live@0.78.0
- @cosmicdrift/kumiko-headless@0.78.0
- @cosmicdrift/kumiko-renderer@0.78.0
- @cosmicdrift/kumiko-renderer-web@0.78.0

## 0.77.1

### Patch Changes

- Updated dependencies [b91862b]
  - @cosmicdrift/kumiko-framework@0.77.1
  - @cosmicdrift/kumiko-headless@0.77.1
  - @cosmicdrift/kumiko-renderer@0.77.1
  - @cosmicdrift/kumiko-dispatcher-live@0.77.1
  - @cosmicdrift/kumiko-renderer-web@0.77.1

## 0.77.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.77.0
- @cosmicdrift/kumiko-dispatcher-live@0.77.0
- @cosmicdrift/kumiko-headless@0.77.0
- @cosmicdrift/kumiko-renderer@0.77.0
- @cosmicdrift/kumiko-renderer-web@0.77.0

## 0.76.1

### Patch Changes

- Updated dependencies [491f034]
  - @cosmicdrift/kumiko-framework@0.76.1
  - @cosmicdrift/kumiko-headless@0.76.1
  - @cosmicdrift/kumiko-renderer@0.76.1
  - @cosmicdrift/kumiko-dispatcher-live@0.76.1
  - @cosmicdrift/kumiko-renderer-web@0.76.1

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

### Patch Changes

- Updated dependencies [5828e0c]
  - @cosmicdrift/kumiko-framework@0.76.0
  - @cosmicdrift/kumiko-headless@0.76.0
  - @cosmicdrift/kumiko-renderer@0.76.0
  - @cosmicdrift/kumiko-dispatcher-live@0.76.0
  - @cosmicdrift/kumiko-renderer-web@0.76.0

## 0.75.0

### Minor Changes

- 3cdad53: Annotate all remaining bundled features with `r.uiHints`

  Twenty-seven features that previously had no `uiHints` block now carry a
  `displayLabel` + `category` + `recommended` flag. They show up in the
  `create-kumiko-app` picker grouped by category (identity, infrastructure,
  storage, notifications, billing, compliance, operations, content, data) —
  the picker no longer hides them as "not yet annotated".

  `create-kumiko-app`'s `FEATURE_CONSTRUCTORS` map gains an entry for every
  zero-arg constructor: 35 features total are now selectable. Features that
  need caller-supplied args (channel-email, channel-push, file-provider-s3,
  managed-pages, subscription-mollie, subscription-stripe, tier-engine)
  remain absent from the constructor map — the picker hides them because
  the scaffolder can't synthesize the required transport/provider config.
  Wire them by hand after scaffolding.

  Refreshed the vendored `feature-manifest.json` so the picker reads the
  new hints out of the box.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.75.0
- @cosmicdrift/kumiko-dispatcher-live@0.75.0
- @cosmicdrift/kumiko-headless@0.75.0
- @cosmicdrift/kumiko-renderer@0.75.0
- @cosmicdrift/kumiko-renderer-web@0.75.0

## 0.74.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.74.0
- @cosmicdrift/kumiko-dispatcher-live@0.74.0
- @cosmicdrift/kumiko-headless@0.74.0
- @cosmicdrift/kumiko-renderer@0.74.0
- @cosmicdrift/kumiko-renderer-web@0.74.0

## 0.73.0

### Minor Changes

- 8aae416: Cross-tenant SystemAdmin admin screens for users + tenants, plus two admin-UI polish fixes

  The bundled `user` and `tenant` features now ship SystemAdmin-gated `entityList` + `entityEdit` screens (`user-list`/`user-edit`, `tenant-list`/`tenant-edit`). Because both features run with `systemScope()`, the lists return every user/tenant across all tenants — the platform-operator roster — with no custom queries. The screens are inert until an app navs them, so existing apps are unaffected; an app gets a full list/detail/edit surface (plus create for users) by adding a single nav entry pointing at the screen. This is the cross-feature gap the boot-validator forbids apps from filling themselves: the screens have to live in the feature that owns the entity.

  The `tenant` feature gained entity-convention handlers (`tenant:query:tenant:{list,detail}`, `tenant:write:tenant:update`) alongside its legacy `tenant:query:list` / `tenant:write:update` ones, so the screens resolve a live data path without renaming anything existing. There is no hard delete (tenants are disabled via `isEnabled`, users go through the GDPR status/forget flow), and the user `roles` field is intentionally not editable from the form (it is a raw-JSON privilege column). A generic `kumiko.actions.edit` default translation backs the list row-action.

  Admin-UI polish: the `DataTable` action column no longer draws a permanent left divider (the sticky background already separates it during horizontal scroll), and `SidebarBrand` only renders its `ChevronsUpDown` affordance when the new optional `collapsible` prop is set — without a wrapping dropdown the chevron suggested a menu that never opened.

### Patch Changes

- Updated dependencies [8aae416]
  - @cosmicdrift/kumiko-renderer-web@0.73.0
  - @cosmicdrift/kumiko-renderer@0.73.0
  - @cosmicdrift/kumiko-framework@0.73.0
  - @cosmicdrift/kumiko-dispatcher-live@0.73.0
  - @cosmicdrift/kumiko-headless@0.73.0

## 0.72.0

### Minor Changes

- a6d3b3b: Add `r.uiHints({...})` for picker/scaffolder metadata

  Features can now declare optional UI metadata via `r.uiHints({ displayLabel, category, recommended, configurableOptions })`. The hints flow through `defineFeature` into `FeatureDefinition.uiHints` and into `feature-manifest.json` under `feature.uiHints`. Pure manifest-side info — the framework runtime does not read it. Consumers (the upcoming `bun create kumiko-app` picker, the docs feature-reference) treat absent hints as "no special treatment" and fall back to `name` + `description`. Eight picker-MVP bundled features carry hints out of the box (`auth-email-password`, `tenant`, `user`, `sessions`, `delivery`, `files`, `billing-foundation`, `feature-toggles`); the remaining bundled features remain unannotated and will be filled in alongside the picker work. Additive — no breaking changes.

- 40c229f: user-data-rights: `userDataRightsClient({ publicDeletion })` mounts the anonymous account-deletion flow as gates

  The login-free deletion screens (`RequestAccountDeletionScreen` + `ConfirmAccountDeletionScreen`) previously had to be wired by each app via a hand-rolled `createPublicSurface`/path-gate. `userDataRightsClient` now accepts an optional `publicDeletion: { requestPath, confirmPath, shell? }`: when set, it registers a `makePublicDeletionGate(...)` that matches `window.location.pathname` and renders the request screen on `requestPath`, the token-confirm screen on `confirmPath`, else passes through. Apps list the client before their auth client (so an anonymous visitor reaches the deletion mask, not the login mask), configure the matching server opts (`deletionTokenSecret`, `deletionVerifyUrl`, `sendDeletionVerificationEmail`), and add the navigation — no per-app deletion screen. `makePublicDeletionGate` + `PublicDeletionRoutes` are exported from `.../user-data-rights/web`. Additive — omitting `publicDeletion` keeps the prior behaviour (privacy-center screen only).

### Patch Changes

- Updated dependencies [a6d3b3b]
  - @cosmicdrift/kumiko-framework@0.72.0
  - @cosmicdrift/kumiko-headless@0.72.0
  - @cosmicdrift/kumiko-renderer@0.72.0
  - @cosmicdrift/kumiko-dispatcher-live@0.72.0
  - @cosmicdrift/kumiko-renderer-web@0.72.0

## 0.71.0

### Minor Changes

- 0be304e: Block locked accounts at the session layer (defense-in-depth)

  The session checker now reads the user's lifecycle status on every authenticated request and refuses a live session whose user is `restricted` or `deleted`, returning the new `"blocked"` `AuthSessionStatus` (401). This is a second layer on top of session revocation: a missed revoke can no longer keep a locked account authenticated. `active` and `deletionRequested` users are unaffected (the latter keeps its session so it can still cancel a pending deletion). The check fails open on a user-row miss so a lookup issue degrades to "revocation still protects" rather than a global lockout. The `sessions` feature now declares `r.requires("user")`.

### Patch Changes

- Updated dependencies [0be304e]
- Updated dependencies [7b8d405]
  - @cosmicdrift/kumiko-framework@0.71.0
  - @cosmicdrift/kumiko-headless@0.71.0
  - @cosmicdrift/kumiko-renderer@0.71.0
  - @cosmicdrift/kumiko-dispatcher-live@0.71.0
  - @cosmicdrift/kumiko-renderer-web@0.71.0

## 0.70.0

### Patch Changes

- Updated dependencies [487734f]
  - @cosmicdrift/kumiko-framework@0.70.0
  - @cosmicdrift/kumiko-headless@0.70.0
  - @cosmicdrift/kumiko-renderer@0.70.0
  - @cosmicdrift/kumiko-dispatcher-live@0.70.0
  - @cosmicdrift/kumiko-renderer-web@0.70.0

## 0.69.0

### Minor Changes

- 18b5cc5: UI new-york alignment (framework batch):

  - `<Section>` / `<Form>` carry `subtitle` + an elevated `actions` footer-row; the
    hard header-divider is gone (title flows into the body, shadcn pattern).
  - `DefaultAppShell` gains a `headerActions` slot (right of the breadcrumb) for the
    theme toggle / global actions.
  - `NavTree` + `DefaultAppShell` gain `navBadges` — a per-leaf runtime badge slot
    keyed by bare nav-id; the app supplies value + color (e.g. a tier badge) without
    baking it into the static nav schema.
  - Bundled `ProfileScreen` adopts the one-card-per-section standard (no more card-in-
    card) with a two-column layout for the short account forms; bundled `TagSection`
    moves its create-tag input + button onto one inline row.

### Patch Changes

- Updated dependencies [18b5cc5]
  - @cosmicdrift/kumiko-renderer@0.69.0
  - @cosmicdrift/kumiko-renderer-web@0.69.0
  - @cosmicdrift/kumiko-framework@0.69.0
  - @cosmicdrift/kumiko-dispatcher-live@0.69.0
  - @cosmicdrift/kumiko-headless@0.69.0

## 0.68.0

### Minor Changes

- d9a62f9: feat(auth): UserMenu sidebar variant — full NavUser footer row across all apps

  The app shell's `sidebarFooter` slot wants the sidebar-07 NavUser row (avatar +
  name + email + chevron), but the bundled `UserMenu` only rendered a compact topbar
  pill, and `SidebarUser` is display-only (no logout/profile actions). Apps were stuck
  choosing between the polished row OR the actions.

  `UserMenu` now takes `variant?: "pill" | "sidebar"` (default `"pill"`, unchanged).
  `variant="sidebar"` renders the full NavUser row as the dropdown trigger — same look
  as `SidebarUser`, but clickable with the existing logout/profile menu. Drop it into
  `sidebarFooter` and every Kumiko app gets the consistent account row.

  renderer-web now also exports `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`
  and `SidebarProvider` so apps can compose custom sidebar content.

### Patch Changes

- Updated dependencies [d9a62f9]
  - @cosmicdrift/kumiko-renderer-web@0.68.0
  - @cosmicdrift/kumiko-framework@0.68.0
  - @cosmicdrift/kumiko-dispatcher-live@0.68.0
  - @cosmicdrift/kumiko-headless@0.68.0
  - @cosmicdrift/kumiko-renderer@0.68.0

## 0.67.1

### Patch Changes

- f5a8a83: fix(renderer-web): robust one-card forms, bare auth forms, missing nav icons

  The 0.66 shadcn "new-york" refresh broke three compositions:

  - **Flat-field forms** (custom screens like the money-horse credit calculator pass
    bare `<Field>` children, no `<Section>`) drew a divider line between _every_ field
    and rendered edge-to-edge. The form body now scopes dividers to consecutive
    `<section>` children only and pads flat children — sectioned auto-UI edit forms are
    unchanged.
  - **Auth screens** render `<Form>` inside `<AuthCard>`; the self-carding form produced
    a card-in-card. `AuthCard` now wraps its children in the new exported
    `BareFormProvider`, so `DefaultForm` renders a bare stacked `<form>` when embedded.
  - **NAV_ICONS** was missing `layers` and `building`, so those nav entries fell back to
    the dot. Both lucide icons are now registered.

- Updated dependencies [f5a8a83]
  - @cosmicdrift/kumiko-renderer-web@0.67.1
  - @cosmicdrift/kumiko-framework@0.67.1
  - @cosmicdrift/kumiko-dispatcher-live@0.67.1
  - @cosmicdrift/kumiko-headless@0.67.1
  - @cosmicdrift/kumiko-renderer@0.67.1

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

### Patch Changes

- Updated dependencies [d732bde]
  - @cosmicdrift/kumiko-framework@0.67.0
  - @cosmicdrift/kumiko-headless@0.67.0
  - @cosmicdrift/kumiko-renderer@0.67.0
  - @cosmicdrift/kumiko-dispatcher-live@0.67.0
  - @cosmicdrift/kumiko-renderer-web@0.67.0

## 0.66.0

### Minor Changes

- 32aa721: Fold the VisualTree navigation into the single shadcn NavTree — one nav, not
  two. Dynamic, runtime-extendable nav nodes now live in the same sidebar as the
  static `r.nav` entries: a node declared with `r.nav({ provider: true })` pulls
  its children lazily from a client-registered nav-provider and refreshes them
  live on entity events (SSE) — the capability the old `navigation: "tree"`
  VisualTree workspace used to provide, now available everywhere.

  **Breaking — `ClientFeatureDefinition` (renderer-web):** the `treeProvider`,
  `treeEntities` and `treeActions` fields are removed. Provide dynamic nav
  children via `navProviders` / `navEntities` (keyed on the nav QN) and editor
  components via `resolvers`, attached to an `r.nav({ provider: true })` node.

  **Breaking — VisualTree removed:** the `VisualTree` / `TreeNodeRenderer`
  components and the tree-providers context are deleted. `WorkspaceShell` always
  renders `NavTree`; a target persisted in the URL (`?t=feat:action&a_*=…`)
  renders the `EditorPanel` in the content area instead of the routed screen.
  `WorkspaceDefinition.navigation` is now a **no-op** (kept for now, deferred
  removal) — `navigation: "tree"` no longer switches the sidebar component.

  **`textContentClient` / `legalPagesClient` (bundled-features):** both now take
  an optional `{ navId }`. The consuming app owns the nav node (label, icon,
  access — same convention as `managed-pages`) by registering
  `r.nav({ id, provider: true })` in its own feature and passing that node's QN
  as `navId`; the bundled-feature supplies the children + editor. **Without
  `navId` no sidebar node is created** — apps that mount these features
  server-side only (legal routes) no longer get a stray, provider-less nav node.

  Migration for an app that used a `navigation: "tree"` workspace (e.g. an admin
  content/legal editor): register `r.nav({ provider: true })` nodes in your own
  feature with the access you want, add their QNs to the workspace's nav members,
  drop `navigation: "tree"`, and pass each node's QN as `navId` to
  `textContentClient({ navId })` / `legalPagesClient({ navId })`.

### Patch Changes

- Updated dependencies [77ed9c1]
- Updated dependencies [7eacfcb]
- Updated dependencies [15b06c1]
- Updated dependencies [32aa721]
- Updated dependencies [15b06c1]
  - @cosmicdrift/kumiko-framework@0.66.0
  - @cosmicdrift/kumiko-headless@0.66.0
  - @cosmicdrift/kumiko-renderer@0.66.0
  - @cosmicdrift/kumiko-renderer-web@0.66.0
  - @cosmicdrift/kumiko-dispatcher-live@0.66.0

## 0.65.0

### Minor Changes

- 6a200dd: feat(user-data-rights): Privacy-Center self-service UI (Art. 15/17/18/20)

  Adds `userDataRightsClient()` and a dormant `privacy-center` custom screen that
  wires data export (Art. 20), the activity log (Art. 15), processing restriction
  (Art. 18), and account deletion (Art. 17) to the existing server handlers. Apps
  mount the client factory in `createKumikoApp({ clientFeatures: [userDataRightsClient()] })`
  and place the screen via `r.nav` in their authenticated area — no per-app UI to
  build. Art. 18 lift stays out of the screen by design (a restricted account is
  login-blocked and cannot reach it; lifting runs via support / magic-link).

- 8de0b3b: tier-engine: optionale Trial-Phase. `createTierEngineFeature({ trial: { tier, durationHours } })` schaltet jedem Tenant für `durationHours` ab seinem Anlage-Datum (`inserted_at` der tier-assignment-Row, rebuild-stabil aus dem Create-Event) zusätzlich die Features von `trial.tier` frei — danach fällt er automatisch auf sein gespeichertes Tier zurück. Rein zeit-abgeleitet (at-resolve-time im tenantTierResolver berechnet, nie gecacht): kein Stored-Flag, kein Scheduler, automatischer Ablauf. Ohne `trial`-Option ist der Resolver byte-identisch zu vorher. Neuer Export `isTrialActive` + Typ `TrialPolicy`.

### Patch Changes

- 09ff47e: custom-fields: fix two event-sourcing correctness gaps.

  1. **Resurrection** — `define → delete → re-define` of the same `(entity, fieldKey)` failed with `version_conflict` (409) permanently: the deterministic aggregate-id left a `created+deleted` stream and the next `create()` collided at version 0, so a deleted custom field could never be re-defined (and its delete-cascade had already wiped the values). `fieldDefinition` is now `softDelete`, and the define handlers resurrect via `restore()` + `update()` (overwriting with the new definition). Quota counts only active definitions.

  2. **PII in the event log** — a custom field marked `sensitive: true` had its value written into the `customField.set` event (via `unsafeAppendEvent`), so a user-forget that strips the projection still left the value in `kumiko_events` (an Art. 17 gap, also undone by a projection rebuild). Sensitive values are now **self-projected** into the host row directly by the write handler — exactly like the entity executor handles `sensitive` entity fields — and the persisted event omits the value. PII never enters the immutable log; the existing forget-strip erases it durably. A projection rebuild loses the value, which is intentional (identical to a `sensitive` entity field).

  Also: `update-tenant-field` now rejects flipping a field's `sensitive` flag (immutable, like `type`) — a non-sensitive→sensitive switch can't retroactively erase already-logged values, so changing sensitivity requires delete + re-define.

  Note: change 1 adds an `is_deleted` column to `read_custom_field_definitions` (entity is now soft-delete) — additive migration required on existing deployments (`kumiko schema` generates the `ALTER TABLE ADD COLUMN`); the quota query and executor depend on it.

- 0550ca4: sessions: `read_user_sessions` nicht mehr als rebuildbare Implicit-Projection registrieren

  Die Tabelle ist ein Hot-Path-Direct-Write-Store — `sessionCreator` legt Rows per `insertOne` an und die Revoke-Handler updaten sie, beides **ohne** Lifecycle-Event. Als `r.entity` registriert wurde sie zur rebuildbaren Implicit-Projection, deren Replay null `user-session.*`-Events findet und einen leeren Shadow über die Live-Tabelle swappt — jeder Projection-Rebuild (Deploy / `schema apply`) löschte still **alle aktiven Sessions** (Mass-Logout, revoked-State weg). Fix: `r.unmanagedTable(buildEntityTableMeta(...))` behält die Migration-DDL, nimmt die Tabelle aber aus dem Implicit-Rebuild — analog zu `jobs`/`channel-in-app`/`feature-toggles`, die ebenfalls Direct-Write-Stores sind. (#498/#494)

- 8678242: tags: rebuild `<TagSection>` as one GitLab-style multi-combobox (chips + searchable dropdown + toggle) instead of a button wall, and fix re-assign after remove. The assignment aggregate-id is deterministic, so removing a tag used to leave a `created+deleted` stream that the next assign hit with `create()` at version 0 → `version_conflict` (409); a removed `(tag, entity)` pair could never be re-attached. `tag-assignment` is now `softDelete: true` and the assign handler restores the stream (detail → restore → create), with the list query filtering removed rows.
- Updated dependencies [6ac4ff6]
- Updated dependencies [773b368]
- Updated dependencies [1586c8c]
  - @cosmicdrift/kumiko-framework@0.65.0
  - @cosmicdrift/kumiko-headless@0.65.0
  - @cosmicdrift/kumiko-renderer@0.65.0
  - @cosmicdrift/kumiko-dispatcher-live@0.65.0
  - @cosmicdrift/kumiko-renderer-web@0.65.0

## 0.64.0

### Patch Changes

- Updated dependencies [dbd1606]
  - @cosmicdrift/kumiko-framework@0.64.0
  - @cosmicdrift/kumiko-headless@0.64.0
  - @cosmicdrift/kumiko-renderer@0.64.0
  - @cosmicdrift/kumiko-dispatcher-live@0.64.0
  - @cosmicdrift/kumiko-renderer-web@0.64.0

## 0.63.0

### Minor Changes

- 9e33766: tags: ship a drop-in web UI. New client subpath `@cosmicdrift/kumiko-bundled-features/tags/web` exports `<TagSection entityName entityId />` (a self-contained tag manager: shows an entity's tags, attach existing / create-and-attach / detach, all via the existing tag handlers) plus `tagsClient()` to register it (component + default i18n). Mount standalone in any screen, or as a `kind: "extension"` section. Server feature unchanged — purely additive client code.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.63.0
- @cosmicdrift/kumiko-dispatcher-live@0.63.0
- @cosmicdrift/kumiko-headless@0.63.0
- @cosmicdrift/kumiko-renderer@0.63.0
- @cosmicdrift/kumiko-renderer-web@0.63.0

## 0.62.0

### Patch Changes

- Updated dependencies [ee56d33]
  - @cosmicdrift/kumiko-headless@0.62.0
  - @cosmicdrift/kumiko-dispatcher-live@0.62.0
  - @cosmicdrift/kumiko-renderer@0.62.0
  - @cosmicdrift/kumiko-renderer-web@0.62.0
  - @cosmicdrift/kumiko-framework@0.62.0

## 0.61.0

### Minor Changes

- 6b624d5: tags: `createTagsFeature` accepts a `toggleable` option so the whole feature can
  be tier-gated through the framework's own machinery — no host-side entity hook.
  Pass `createTagsFeature({ toggleable: { default: false } })` and list the feature
  name (`tags`) in the entitling tiers' `TierMap`; the tier-engine + feature-toggles
  then enable/disable every tag write/read path per tenant (fail-closed below the
  tier). Omitting `toggleable` keeps tags always-on (unchanged default).

### Patch Changes

- @cosmicdrift/kumiko-framework@0.61.0
- @cosmicdrift/kumiko-dispatcher-live@0.61.0
- @cosmicdrift/kumiko-headless@0.61.0
- @cosmicdrift/kumiko-renderer@0.61.0
- @cosmicdrift/kumiko-renderer-web@0.61.0

## 0.60.4

### Patch Changes

- Updated dependencies [7f55219]
  - @cosmicdrift/kumiko-framework@0.60.4
  - @cosmicdrift/kumiko-headless@0.60.4
  - @cosmicdrift/kumiko-renderer@0.60.4
  - @cosmicdrift/kumiko-dispatcher-live@0.60.4
  - @cosmicdrift/kumiko-renderer-web@0.60.4

## 0.60.3

### Patch Changes

- Updated dependencies [af1b957]
  - @cosmicdrift/kumiko-framework@0.60.3
  - @cosmicdrift/kumiko-headless@0.60.3
  - @cosmicdrift/kumiko-renderer@0.60.3
  - @cosmicdrift/kumiko-dispatcher-live@0.60.3
  - @cosmicdrift/kumiko-renderer-web@0.60.3

## 0.60.2

### Patch Changes

- Updated dependencies [68c5fee]
  - @cosmicdrift/kumiko-framework@0.60.2
  - @cosmicdrift/kumiko-headless@0.60.2
  - @cosmicdrift/kumiko-renderer@0.60.2
  - @cosmicdrift/kumiko-dispatcher-live@0.60.2
  - @cosmicdrift/kumiko-renderer-web@0.60.2

## 0.60.1

### Patch Changes

- Updated dependencies [bde2443]
  - @cosmicdrift/kumiko-framework@0.60.1
  - @cosmicdrift/kumiko-headless@0.60.1
  - @cosmicdrift/kumiko-renderer@0.60.1
  - @cosmicdrift/kumiko-dispatcher-live@0.60.1
  - @cosmicdrift/kumiko-renderer-web@0.60.1

## 0.60.0

### Minor Changes

- 9ae7ab8: tags: `createTagsFeature` accepts an `access` rule so a host can adopt its own
  authorization model for every tag write/read path — e.g.
  `createTagsFeature({ access: { openToAll: true } })` for apps whose handlers are
  open to any authenticated tenant user, instead of being pinned to the default
  `{ roles: ["TenantAdmin","TenantMember"] }`. The `roles` shorthand stays as a
  convenience (`{ roles }` → `{ access: { roles } }`); `access` takes precedence.
- fec57ca: tier-engine: add a SystemAdmin-only manual tier grant so an operator can
  assign any tenant a pricing tier **without a billing purchase** — the missing
  piece for testing and operating `>Free` features before Stripe is wired.

  - `tier-engine:write:set-tenant-tier` — cross-tenant upsert keyed on the
    deterministic per-tenant aggregate-id. Writes through a `"system"`-mode
    `TenantDb` on the **target** tenant so the event lands in the target's
    stream (the `set.write` override-user pattern only reaches
    `SYSTEM_TENANT_ID`). Stamps `source: "manual"` so a future Stripe→tier sync
    won't overwrite the grant. Updates the resolver cache synchronously after
    the write so the grant changes the tenant's **effective** feature set, not
    just the projection (a direct executor write doesn't fire the `postSave`
    hook the entity-handler path relies on).
  - `tier-engine:query:get-tenant-tier` — cross-tenant read of any tenant's
    assignment (SystemAdmin-only).
  - `tier-engine:query:tier-options` — exposes the configured `TierMap`'s tier
    names to the client (the map is a server-side closure).
  - `tier-assignment` entity gains an optional `source` field
    (`"manual" | "stripe" | "default"`); the auto-default-on-signup hook now
    stamps `"default"`. Additive + nullable — back-compat with existing rows.
  - New `tier-admin` custom screen (`r.screen`, SystemAdmin-only) plus a
    `tierEngineClient()` client feature exported from
    `@cosmicdrift/kumiko-bundled-features/tier-engine/web`. Apps surface it with
    a single `r.nav({ screen: "tier-engine:screen:tier-admin" })`.

  Writes stay SystemAdmin-only (a TenantAdmin setting their own tier would be a
  free self-upgrade); an integration test pins the cross-tenant boundary,
  fail-closed denial for non-SystemAdmins, `source: "manual"`, and idempotent
  upsert.

### Patch Changes

- Updated dependencies [95a4a6c]
- Updated dependencies [16e1457]
- Updated dependencies [22c1ba2]
- Updated dependencies [34cb6e7]
- Updated dependencies [141d29b]
  - @cosmicdrift/kumiko-framework@0.60.0
  - @cosmicdrift/kumiko-headless@0.60.0
  - @cosmicdrift/kumiko-renderer@0.60.0
  - @cosmicdrift/kumiko-dispatcher-live@0.60.0
  - @cosmicdrift/kumiko-renderer-web@0.60.0

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
  - @cosmicdrift/kumiko-headless@0.59.2
  - @cosmicdrift/kumiko-renderer@0.59.2
  - @cosmicdrift/kumiko-dispatcher-live@0.59.2
  - @cosmicdrift/kumiko-renderer-web@0.59.2

## 0.59.1

### Patch Changes

- e8dacba: Clarify the `inheritedToTenant` redaction contract. The read-redaction doc
  overstated the guarantee: it claimed a tenant-side viewer learns neither the
  inherited platform value "nor that it is set". That holds for the value-
  returning queries (`config:query:cascade`, `config:query:values`), which mask
  both the value and its presence — but `config:query:readiness` deliberately
  reports an `inheritedToTenant:false` key set only at system-level as satisfied
  rather than missing. Redaction is display-only (the resolver never consults
  `inheritedToTenant`), so the tenant functionally inherits the value; flagging it
  as missing would nag tenants to set already-working config. Documented the
  boundary in `read-redaction.ts` and `readiness.query.ts`; no behaviour change.
- Updated dependencies [99b8220]
- Updated dependencies [31d2d99]
- Updated dependencies [731d87f]
- Updated dependencies [103c5f5]
- Updated dependencies [8a55f62]
  - @cosmicdrift/kumiko-framework@0.59.1
  - @cosmicdrift/kumiko-renderer@0.59.1
  - @cosmicdrift/kumiko-headless@0.59.1
  - @cosmicdrift/kumiko-renderer-web@0.59.1
  - @cosmicdrift/kumiko-dispatcher-live@0.59.1

## 0.59.0

### Minor Changes

- 6ea62ca: Neues bundled-feature `tags`: generisches, host-agnostisches Tagging für **jede**
  Entity — ohne Spalte am Host, ohne Migration, ohne relationalen Pivot/JOIN.

  Das Feature besitzt zwei event-sourced Entities: den per-Tenant Tag-Katalog
  (`read_tags`) und `tag-assignment`-Join-Rows, gekeyt auf `(entityType, entityId)`
  (`read_tag_assignments`). Beide Tabellen projiziert das Framework aus ihren
  eigenen CRUD-Events — kein handgeschriebener MSP. Eine deterministische
  aggregate-id pro `(tenant, tag, entity)` macht `assign-tag`/`remove-tag`
  idempotent.

  Handler: `tags:write:create-tag`, `tags:write:assign-tag`, `tags:write:remove-tag`
  sowie List-Queries für Katalog und Assignments. Cross-Entity-Sichten („Tags einer
  Entity" / „Entities mit einem Tag") entstehen durch Komposition im Read-Layer —
  `tag-assignment:list` gefiltert auf `entityId` bzw. `tagId`. Default-Rollen via
  `createTagsFeature({ roles })` überschreibbar.

  Siehe `samples/recipes/tags-basic/`.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.59.0
- @cosmicdrift/kumiko-dispatcher-live@0.59.0
- @cosmicdrift/kumiko-headless@0.59.0
- @cosmicdrift/kumiko-renderer@0.59.0
- @cosmicdrift/kumiko-renderer-web@0.59.0

## 0.58.0

### Patch Changes

- 9733ddc: Bump `nodemailer` 8 → 9.0.1 to clear GHSA-p6gq-j5cr-w38f (HIGH): the
  message-level `raw` option bypassed `disableFileAccess`/`disableUrlAccess`,
  enabling arbitrary file read and SSRF in the delivered message. The SMTP
  transport only uses `createTransport` + `sendMail` with structured fields
  (never `raw`), so the public API is unchanged — this is a defense-in-depth
  upgrade. 9.0.1 also clears the 8.0.9 advisories GHSA-268h-hp4c-crq3 and
  GHSA-wqvq-jvpq-h66f.
- 625a4e2: Add `runTemplateConsumerConformance` harness for template-resolver consumers (closes #265).
- Updated dependencies [9733ddc]
- Updated dependencies [b02c52e]
- Updated dependencies [0202d38]
- Updated dependencies [a3dcb2c]
- Updated dependencies [f9897cd]
  - @cosmicdrift/kumiko-framework@0.58.0
  - @cosmicdrift/kumiko-headless@0.58.0
  - @cosmicdrift/kumiko-renderer@0.58.0
  - @cosmicdrift/kumiko-dispatcher-live@0.58.0
  - @cosmicdrift/kumiko-renderer-web@0.58.0

## 0.57.2

### Patch Changes

- ea2d54d: ConfirmAccountDeletionScreen now distinguishes a failed request (network/server error → generic "something went wrong" message) from an invalid-or-expired token, instead of always showing the invalid-token banner on any failure.
- 99d4489: Correctness fixes from PR review:

  - `securePageHeaders` now spreads hardened security headers LAST so a caller's `extra` can never override CSP/nosniff/frame-options.
  - `assertOriginGuardConfig` throws on the contradictory `unsafeSkipOriginCheck: true` + non-empty `allowedOrigins` combo instead of silently keeping the guard.
  - Decimal write-schema scale check is now float-robust (`isRepresentableAtScale`): a computed-but-in-scale value like `0.1 + 0.2` is accepted at scale 2 instead of being falsely rejected.
  - `createDecimalField` validates `precision`/`scale` at definition time (integer, `precision ≥ 1`, `0 ≤ scale ≤ precision`) instead of failing at migration time.
  - ENV config bridge skips whitespace-only values and trims `select`/`text` values before option matching.
  - `fenceLiveTable` rejects `lockTimeoutMs <= 0` (Postgres treats `lock_timeout = 0` as wait-forever, the opposite of fail-fast).
  - Deletion verify-URL is built via `URL`/`searchParams` so a base URL with existing query params no longer produces an invalid `?a=b?token=`.

- Updated dependencies [99d4489]
  - @cosmicdrift/kumiko-framework@0.57.2
  - @cosmicdrift/kumiko-headless@0.57.2
  - @cosmicdrift/kumiko-renderer@0.57.2
  - @cosmicdrift/kumiko-dispatcher-live@0.57.2
  - @cosmicdrift/kumiko-renderer-web@0.57.2

## 0.57.1

### Patch Changes

- Updated dependencies [d07ef3f]
  - @cosmicdrift/kumiko-framework@0.57.1
  - @cosmicdrift/kumiko-headless@0.57.1
  - @cosmicdrift/kumiko-renderer@0.57.1
  - @cosmicdrift/kumiko-dispatcher-live@0.57.1
  - @cosmicdrift/kumiko-renderer-web@0.57.1

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

### Patch Changes

- Updated dependencies [4c32f16]
- Updated dependencies [2e78232]
  - @cosmicdrift/kumiko-renderer@0.57.0
  - @cosmicdrift/kumiko-renderer-web@0.57.0
  - @cosmicdrift/kumiko-framework@0.57.0
  - @cosmicdrift/kumiko-headless@0.57.0
  - @cosmicdrift/kumiko-dispatcher-live@0.57.0

## 0.56.1

### Patch Changes

- a72f3a1: config: don't optimistic-lock config writes (fixes save after a version desync)

  Saving an existing config value compared the _projection_ row version against
  the _event-stream_ version. If those drifted — a migration or seed that wrote
  the read-row outside the normal event flow, like the Stripe config cut-over —
  every save version-conflicted forever (`errors.versionConflict` on the
  Settings-Hub screen).

  Config is single-writer operator state, not a collaboratively-edited
  aggregate, so `set.write` now skips the optimistic lock and appends at the
  real stream version. The save succeeds and the projection resyncs (self-heals
  the drift). Covered by an integration test that corrupts the projection
  version and asserts the save still round-trips.

  - @cosmicdrift/kumiko-framework@0.56.1
  - @cosmicdrift/kumiko-dispatcher-live@0.56.1
  - @cosmicdrift/kumiko-headless@0.56.1
  - @cosmicdrift/kumiko-renderer@0.56.1
  - @cosmicdrift/kumiko-renderer-web@0.56.1

## 0.56.0

### Patch Changes

- Updated dependencies [c9a0ef8]
  - @cosmicdrift/kumiko-framework@0.56.0
  - @cosmicdrift/kumiko-headless@0.56.0
  - @cosmicdrift/kumiko-renderer@0.56.0
  - @cosmicdrift/kumiko-dispatcher-live@0.56.0
  - @cosmicdrift/kumiko-renderer-web@0.56.0

## 0.55.1

### Patch Changes

- 8ccc145: config: let a human operator write a `privileged` key (fixes Settings-Hub save)

  `checkWriteAccess` treated any config key whose write-set contained
  `SYSTEM_ROLE` as machine-only and rejected every human with
  `config.errors.systemOnly` — even when the write-set also named a human
  role. So a key declared `access.privileged` (`["system", "SystemAdmin"]`,
  e.g. Stripe `billing-live`) could not be saved from the derived
  Settings-Hub screen by a SystemAdmin, although `build-config-feature-schema`
  deliberately surfaces it to one. Saving the whole system-scope screen failed.

  The check now grants access directly when the user's roles match the
  write-set (machine actor for `SYSTEM_ROLE`, operator for `SystemAdmin`), and
  only returns `systemOnly` for a key whose _sole_ writer is `SYSTEM_ROLE`
  (the `access.system` preset). A non-SystemAdmin human is still denied
  (generic `access_denied`, not `systemOnly`).

  Also ships default German/English translations for the `config.errors.*`
  keys (`systemOnly`, `invalidScope`, `unknownKey`) via `configClient()`, so
  config write errors render as text instead of a raw i18n key.

  The derived configEdit screen no longer renders a source badge next to each
  field label — that duplicated the source shown by the cascade disclosure
  below the input (one "Fehlt"/"System" badge per field instead of two).

- Updated dependencies [acdc14c]
  - @cosmicdrift/kumiko-renderer-web@0.55.1
  - @cosmicdrift/kumiko-framework@0.55.1
  - @cosmicdrift/kumiko-dispatcher-live@0.55.1
  - @cosmicdrift/kumiko-headless@0.55.1
  - @cosmicdrift/kumiko-renderer@0.55.1

## 0.55.0

### Patch Changes

- Updated dependencies [17fa9ee]
  - @cosmicdrift/kumiko-framework@0.55.0
  - @cosmicdrift/kumiko-headless@0.55.0
  - @cosmicdrift/kumiko-renderer@0.55.0
  - @cosmicdrift/kumiko-dispatcher-live@0.55.0
  - @cosmicdrift/kumiko-renderer-web@0.55.0

## 0.54.0

### Patch Changes

- Updated dependencies [a565b61]
- Updated dependencies [e7a7809]
- Updated dependencies [b2e3a56]
- Updated dependencies [1135437]
  - @cosmicdrift/kumiko-framework@0.54.0
  - @cosmicdrift/kumiko-renderer-web@0.54.0
  - @cosmicdrift/kumiko-renderer@0.54.0
  - @cosmicdrift/kumiko-headless@0.54.0
  - @cosmicdrift/kumiko-dispatcher-live@0.54.0

## 0.53.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.53.0
- @cosmicdrift/kumiko-dispatcher-live@0.53.0
- @cosmicdrift/kumiko-headless@0.53.0
- @cosmicdrift/kumiko-renderer@0.53.0
- @cosmicdrift/kumiko-renderer-web@0.53.0

## 0.52.0

### Minor Changes

- c014f18: subscription-stripe: declare the Stripe credentials as `backing:"secrets"` config keys (auto-derived settings screen)

  The Stripe API key + webhook secret move from hand-rolled `r.secret`
  declarations to system config keys with `backing:"secrets"`
  (`subscription-stripe:config:api-key` / `:webhook-secret`). Each carries a
  `mask`, so the config feature derives the sysadmin settings screen + Settings-Hub
  nav automatically — consuming apps no longer hand-write a Stripe-config screen,
  its query/set handlers, or the QN-contract constants. `billingLive` gains a
  `mask` too (write `["system", "SystemAdmin"]`) so the same derived screen
  flips go-live.

  The value still lives envelope-encrypted in the secrets store under the system
  tenant; reads round-trip through `SecretsContext.get(config-QN)` (the webhook
  path stays context-less + un-audited, now JSON-parsing the stored config value).
  The `apiKey` / `webhookSecret` factory options remain as env→secrets bridge
  fallbacks.

  **BREAKING (operator action on deploy):** the secret-store key name changes
  from `subscription-stripe:secret:<name>` to `subscription-stripe:config:<name>`,
  so the existing prod values are not read by the new declaration. After deploying,
  re-enter the Stripe API key + webhook secret once via the derived sysadmin
  settings screen (or `config:write:set`). `billingLive` is unaffected (it stays a
  config key under the same name). No data migration is required — the keys are
  simply re-entered.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.52.0
- @cosmicdrift/kumiko-dispatcher-live@0.52.0
- @cosmicdrift/kumiko-headless@0.52.0
- @cosmicdrift/kumiko-renderer@0.52.0
- @cosmicdrift/kumiko-renderer-web@0.52.0

## 0.51.0

### Minor Changes

- f51c8a8: legal-pages: harden the server-render path against untrusted authors. Raw HTML in Markdown bodies is now escaped instead of passed through (`<script>` → `&lt;script&gt;`), link/image hrefs are scheme-restricted to http(s)/mailto/relative (`javascript:`/`data:` neutralised to `#`), and every server-rendered response carries `Content-Security-Policy: script-src 'none'; object-src 'none'; base-uri 'none'` plus `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy`. Closes a latent stored-XSS in `renderMarkdownToHtml`. Markdown structure (headings, lists, links, code) is unaffected; no `default-src` is set, so inline `<style>` layouts keep working.
- f51c8a8: managed-pages: new framework capability for tenant-editable, server-rendered public pages with per-tenant branding and tier-gated, allowlist-sanitized custom CSS.

  - A `page` entity (`read_pages`, keyed `(tenantId, slug, lang)`) with a `published` gate plus `description`/`ogImage` SEO meta, authored via TenantAdmin/SystemAdmin `entityList`/`entityEdit` screens and convention CRUD.
  - An anonymous `GET {basePath}/:slug` route that resolves the tenant from the request Host via an app-supplied `resolveApexTenant`, serves only published pages (drafts → 404), renders Markdown through the hardened `page-render` core (raw HTML escaped), and isolates per-tenant content with `Vary: Host`.
  - Per-tenant branding `config` keys (`branding-{title,description,site-url,accent-color,logo-url,layout-preset}`) with write-time validation (hex color, https URLs) and a `configEdit` self-service screen; applied at render as scoped `:root` vars + a logo/title header.
  - Opt-in `allowCustomCss` (default false, fail-closed): a raw per-tenant CSS key emitted as a scoped, allowlist-sanitized `<style data-tenant-css>` block — `@import`/`url()`/`expression()`/`</style>`-breakout/scope-escape closed by construction, paint clipped to the content box. Gated per-tenant by the companion `managed-pages-css` toggle (`createManagedPagesCssFeature`). `tenantStyleBlock`/`TENANT_CONTENT_ATTR` are exported so a custom `wrapLayout` emits tenant CSS with the same containment.

  Also: the feature-manifest now carries the `pattern` validator on text config keys. `ConfigKeyDefinition.pattern`'s JSDoc already promised JSON survival (feature-manifest, docgen), but the manifest serializer was dropping the field — it now surfaces hex/https/length format constraints in the generated manifest.

### Patch Changes

- Updated dependencies [9916c33]
- Updated dependencies [ac282fb]
- Updated dependencies [b40187f]
  - @cosmicdrift/kumiko-renderer-web@0.51.0
  - @cosmicdrift/kumiko-framework@0.51.0
  - @cosmicdrift/kumiko-headless@0.51.0
  - @cosmicdrift/kumiko-renderer@0.51.0
  - @cosmicdrift/kumiko-dispatcher-live@0.51.0

## 0.50.0

### Patch Changes

- c5610ea: tenant: batch-load tenants in the `memberships` query (#324)

  The `memberships` query enriched each membership with its tenant name/key via
  one `fetchOne` per row — an accepted N+1, run on every login and switch-tenant.
  The query-builder already supports `where: { id: [...] }` → `IN (...)`, so it now
  loads all referenced tenants in a single batch and maps each membership from a
  lookup table. Behaviour is unchanged: disabled tenants are still filtered, and a
  membership whose tenant projection row is missing (drift) is still kept without
  name/key (no login lockout).

- Updated dependencies [f06e33a]
- Updated dependencies [d8330bc]
- Updated dependencies [8ca4a27]
- Updated dependencies [0d92100]
- Updated dependencies [d8083ae]
- Updated dependencies [eabad73]
- Updated dependencies [6b16dd9]
  - @cosmicdrift/kumiko-framework@0.50.0
  - @cosmicdrift/kumiko-renderer-web@0.50.0
  - @cosmicdrift/kumiko-headless@0.50.0
  - @cosmicdrift/kumiko-renderer@0.50.0
  - @cosmicdrift/kumiko-dispatcher-live@0.50.0

## 0.49.0

### Patch Changes

- 5ffbc19: auth-email-password: self-signup rejects an already-registered email instead of logging into the existing account (#365)

  `provisionSignupAccount` was silently idempotent — for an email that already
  had a user (seeding or a prior signup) it reused the existing user and minted
  a session for them, plus created an orphan tenant. Anyone able to receive the
  magic link at a reachable inbox could thereby be logged into the existing
  account (e.g. a seeded SystemAdmin). It is now create-only: it throws
  `ConflictError` before any tenant is created, and `signup-confirm` translates
  that into a clean `signup_email_already_registered` error without minting a
  session. The matching JSDoc/comment drift (which claimed the throw already
  happened) is corrected.

- Updated dependencies [5d8b8ca]
  - @cosmicdrift/kumiko-framework@0.49.0
  - @cosmicdrift/kumiko-headless@0.49.0
  - @cosmicdrift/kumiko-renderer@0.49.0
  - @cosmicdrift/kumiko-dispatcher-live@0.49.0
  - @cosmicdrift/kumiko-renderer-web@0.49.0

## 0.48.1

### Patch Changes

- b8207de: subscription-stripe: stop pinning a hardcoded Stripe `apiVersion` (#256)

  The Stripe client was constructed with a string-literal `apiVersion`
  (`"2026-04-22.dahlia"`). Because bundled-features ship as TS sources, every
  consumer typechecks this file against its own resolved `stripe` SDK — and a
  consumer on a newer SDK (e.g. `^22.2.0`) fails with
  `TS2322: "2026-04-22.dahlia" is not assignable to "<newer>"`, since the literal
  no longer matches the SDK's `Stripe.LatestApiVersion`.

  The client is now constructed without an `apiVersion`. The SDK falls back to its
  own `DEFAULT_API_VERSION` — the exact version its types are generated against —
  so the wire API version and the TS types always move together when the consumer
  bumps `stripe`. This is behaviorally identical for stripe `22.1.1` (whose default
  _is_ `2026-04-22.dahlia`) and removes the latent typecheck break for newer SDKs.

  Consumers that worked around this with `overrides.stripe = "22.1.1"` can drop
  that pin once they upgrade.

- Updated dependencies [ec22610]
  - @cosmicdrift/kumiko-framework@0.48.1
  - @cosmicdrift/kumiko-headless@0.48.1
  - @cosmicdrift/kumiko-renderer@0.48.1
  - @cosmicdrift/kumiko-dispatcher-live@0.48.1
  - @cosmicdrift/kumiko-renderer-web@0.48.1

## 0.48.0

### Patch Changes

- Updated dependencies [2852197]
  - @cosmicdrift/kumiko-framework@0.48.0
  - @cosmicdrift/kumiko-headless@0.48.0
  - @cosmicdrift/kumiko-renderer@0.48.0
  - @cosmicdrift/kumiko-dispatcher-live@0.48.0
  - @cosmicdrift/kumiko-renderer-web@0.48.0

## 0.47.0

### Minor Changes

- f32f99d: Apex-Surface v1 — der evidente Weg für öffentlichen, schema-losen Apex-Content (Login/Register/Passwort-vergessen/Konto-löschen) in jeder Kumiko-App.

  **`@cosmicdrift/kumiko-renderer-web`: `createPublicSurface`** — das öffentliche Gegenstück zu `createKumikoApp`. Schema-LOSER Mount (`injectSchema: false`, kein `__KUMIKO_SCHEMA__`, kein Topologie-Leak), Match-once-Routing, optionaler `shell`-Wrapper. Stackt von übergebenen `clientFeatures` nur `providers` + `translations` — bewusst **nicht** deren `gates` (ein AuthGate würde die öffentliche Surface hinter Login sperren).

  **`@cosmicdrift/kumiko-bundled-features` (auth-email-password): `AuthShell`** — `AuthCard` rendert jetzt über einen optionalen `useAuthShell()`-Renderer. Default bleibt der Fullscreen-Wrapper (rückwärtskompatibel); `AuthShellProvider` lässt Apps die Auth-Card in ihrer Marketing-Chrome statt Fullscreen rendern.

  **`@cosmicdrift/kumiko-bundled-features` (user-data-rights): anonymer, email-verifizierter Deletion-Flow** — DSGVO Art. 17 greift gerade beim Lockout (User kann sich nicht mehr einloggen). Zwei neue anonyme Handler: `request-deletion-by-email` (enumeration-safe, Magic-Link) + `confirm-deletion-by-token` (idempotent, startet dieselbe Grace-Period wie der authentifizierte Pfad via geteiltem `startDeletionGracePeriod`). HMAC-Token trägt `userId` + Expiry selbst (kein DB-Table/Redis/Migration), Purpose `"deletion-request"`. Neue Options `deletionTokenSecret` / `deletionVerifyUrl` / `sendDeletionVerificationEmail` (Callback MUSS non-blocking/enqueue sein — synchroner Send öffnet ein Timing-Oracle für Account-Enumeration).

### Patch Changes

- Updated dependencies [f32f99d]
  - @cosmicdrift/kumiko-renderer-web@0.47.0
  - @cosmicdrift/kumiko-framework@0.47.0
  - @cosmicdrift/kumiko-dispatcher-live@0.47.0
  - @cosmicdrift/kumiko-headless@0.47.0
  - @cosmicdrift/kumiko-renderer@0.47.0

## 0.46.0

### Patch Changes

- Updated dependencies [7751b71]
  - @cosmicdrift/kumiko-framework@0.46.0
  - @cosmicdrift/kumiko-headless@0.46.0
  - @cosmicdrift/kumiko-renderer@0.46.0
  - @cosmicdrift/kumiko-dispatcher-live@0.46.0
  - @cosmicdrift/kumiko-renderer-web@0.46.0

## 0.45.1

### Patch Changes

- Updated dependencies [3053ef8]
  - @cosmicdrift/kumiko-framework@0.45.1
  - @cosmicdrift/kumiko-headless@0.45.1
  - @cosmicdrift/kumiko-renderer@0.45.1
  - @cosmicdrift/kumiko-dispatcher-live@0.45.1
  - @cosmicdrift/kumiko-renderer-web@0.45.1

## 0.45.0

### Minor Changes

- 2764993: Bug-Bash 3 Wave L — Renderer- + Bundled-Features-Verbesserungen:

  - **DataTable `rowActionMode="inline"`** (#8/#9): neues Prop, das Row-Actions
    immer als linksbündige Inline-Buttons rendert (auch bei >2 Actions, kein
    Kebab) — einheitliche, ausgerichtete Optik über alle Listen. Default bleibt
    `"adaptive"` (bisheriges Verhalten).
  - **Config-Default-Wording** (#11): Cascade-Disclosure nutzt denselben Begriff
    „Standard"/„Default" wie das Feld-Label-Badge (statt „Vorgabe"/„Preset") —
    ein durchgängiger Begriff. Der Key `kumiko.config.cascade.preset` entfällt.
  - **`slots.header`-Placement** (#12): der List-Header-Slot (z.B. Cap-Counter)
    rendert jetzt in der Listen-Toolbar statt als loser Text über dem Screen-Titel.
  - **Composed Extension-Save** (#1): neuer `useExtensionFormSubmit`-Mechanismus —
    Extension-Sections (z.B. Custom-Fields) schreiben beim Haupt-Form-Submit mit,
    statt einen eigenen Save-Button zu führen. Der Haupt-Save aktiviert sich auch
    bei reiner Section-Änderung.
  - **Profil-Seite** (#3): Sektionen als abgegrenzte Karten, Danger-Zone hervorgehoben.

### Patch Changes

- Updated dependencies [2764993]
  - @cosmicdrift/kumiko-renderer@0.45.0
  - @cosmicdrift/kumiko-renderer-web@0.45.0
  - @cosmicdrift/kumiko-framework@0.45.0
  - @cosmicdrift/kumiko-dispatcher-live@0.45.0
  - @cosmicdrift/kumiko-headless@0.45.0

## 0.44.0

### Patch Changes

- Updated dependencies [b082294]
  - @cosmicdrift/kumiko-framework@0.44.0
  - @cosmicdrift/kumiko-headless@0.44.0
  - @cosmicdrift/kumiko-renderer@0.44.0
  - @cosmicdrift/kumiko-dispatcher-live@0.44.0
  - @cosmicdrift/kumiko-renderer-web@0.44.0

## 0.43.0

### Patch Changes

- Updated dependencies [5b04c40]
  - @cosmicdrift/kumiko-renderer@0.43.0
  - @cosmicdrift/kumiko-renderer-web@0.43.0
  - @cosmicdrift/kumiko-framework@0.43.0
  - @cosmicdrift/kumiko-dispatcher-live@0.43.0
  - @cosmicdrift/kumiko-headless@0.43.0

## 0.42.0

### Minor Changes

- 81ac289: subscription-stripe: Stripe-Keys + billing-live zur Laufzeit aus config/secrets

  Der `subscription-stripe`-Plugin liest seine Credentials jetzt **zur Laufzeit** statt aus einem mount-time-Closure — Keys rotieren und prod geht live ohne Redeploy.

  - `subscription-stripe:secret:api-key` + `:webhook-secret` → **secrets** (encrypted-at-rest, unter `SYSTEM_TENANT_ID` da app-wide).
  - `subscription-stripe:config:billingLive` → **system config** (boolean, default `false`). Master-Switch: `createCheckoutSession` wirft `feature_disabled` solange `billingLive` nicht `true` ist — `sk_test_`-Keys in prod erzeugen damit nie einen live-Checkout.
  - Das Feature requires jetzt zusätzlich `config` + `secrets` und mountet **immer** (kein key-presence-Guard mehr). Die factory-options `apiKey`/`webhookSecret` sind jetzt **optional** und dienen nur noch als env→secrets-Bridge-Fallback; `priceToTier` bleibt eine factory-option.

  `billing-foundation`: `SubscriptionProviderPlugin.verifyAndParseWebhook` bekommt einen optionalen 3. Parameter (system-scoped `SecretsContext`), den der webhook-handler durchreicht (`SubscriptionWebhookDeps.systemSecrets`). Damit lesen Provider ihre app-wide-Secrets pre-tenant zur Laufzeit. Additiv + backward-compatible — `subscription-mollie` ignoriert den Param.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.42.0
- @cosmicdrift/kumiko-dispatcher-live@0.42.0
- @cosmicdrift/kumiko-headless@0.42.0
- @cosmicdrift/kumiko-renderer@0.42.0
- @cosmicdrift/kumiko-renderer-web@0.42.0

## 0.41.1

### Patch Changes

- Updated dependencies [1e7a66e]
  - @cosmicdrift/kumiko-framework@0.41.1
  - @cosmicdrift/kumiko-headless@0.41.1
  - @cosmicdrift/kumiko-renderer@0.41.1
  - @cosmicdrift/kumiko-dispatcher-live@0.41.1
  - @cosmicdrift/kumiko-renderer-web@0.41.1

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
  - @cosmicdrift/kumiko-renderer@0.41.0
  - @cosmicdrift/kumiko-headless@0.41.0
  - @cosmicdrift/kumiko-renderer-web@0.41.0
  - @cosmicdrift/kumiko-dispatcher-live@0.41.0

## 0.40.1

### Patch Changes

- Updated dependencies [667c79b]
  - @cosmicdrift/kumiko-framework@0.40.1
  - @cosmicdrift/kumiko-headless@0.40.1
  - @cosmicdrift/kumiko-renderer@0.40.1
  - @cosmicdrift/kumiko-dispatcher-live@0.40.1
  - @cosmicdrift/kumiko-renderer-web@0.40.1

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
  - @cosmicdrift/kumiko-renderer@0.40.0
  - @cosmicdrift/kumiko-renderer-web@0.40.0
  - @cosmicdrift/kumiko-headless@0.40.0
  - @cosmicdrift/kumiko-dispatcher-live@0.40.0

## 0.39.0

### Minor Changes

- 12e1137: Neues bundled feature `user-profile` — Self-Service-Kontoseite:

  - `user-profile:write:change-email`: E-Mail ändern mit Re-Auth
    (aktuelles Passwort), Uniqueness-Check und `emailVerified`-Reset;
    der Screen triggert anschließend den Verification-Flow.
  - `ProfileScreen`-Web-Komponente (Passwort ändern via
    auth-email-password, E-Mail ändern, Konto löschen / Löschung
    abbrechen via user-data-rights mit Grace-Period und Dialog-Confirm)
    - `userProfileClient()` mit de/en-Bundles.
  - Requires `user`, `auth-email-password`, `user-data-rights`.
  - Recipe `samples/recipes/user-profile` zeigt das App-Wiring
    (custom-Screen + `__component: "UserProfileScreen"`).

### Patch Changes

- Updated dependencies [34cb1f7]
  - @cosmicdrift/kumiko-framework@0.39.0
  - @cosmicdrift/kumiko-renderer@0.39.0
  - @cosmicdrift/kumiko-renderer-web@0.39.0
  - @cosmicdrift/kumiko-dispatcher-live@0.39.0

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

- 7a00d80: Type reconciliation: `FeatureDefinition.entities/hooks/entityHooks` and every slot of `HookMap`/`EntityHookMap` are now optional (`?:`) — matching the documented runtime contract (hand-built definitions at system boundaries omit slots; the registry guards against that, pinned by the "slot robustness" tests since #95/#98/#210). The previous required typing was a compiler lie that forced `?.`/`?? {}` guards to contradict the types. All production read-sites now guard explicitly; the single remaining `as HookMap` in defineFeature is the documented engine-bridge for the per-slot signature erasure in hook registration.
- Updated dependencies [8becbed]
- Updated dependencies [0f093f1]
- Updated dependencies [ffcce8a]
- Updated dependencies [7a00d80]
  - @cosmicdrift/kumiko-framework@0.38.0
  - @cosmicdrift/kumiko-renderer@0.38.0
  - @cosmicdrift/kumiko-renderer-web@0.38.0
  - @cosmicdrift/kumiko-dispatcher-live@0.38.0

## 0.37.0

### Minor Changes

- createAuthMailerConfig: Factory für Auth-Mail-Setups

  Neue Exporte aus `@cosmicdrift/kumiko-bundled-features/auth-email-password`:

  - `createAuthMailerConfig(args)` — baut `passwordReset`, `emailVerification`,
    `signup` und `invite` Setups gegen `mailSender` + Render-Funktionen in
    einem Aufruf. Nimmt `hmacSecret`, `baseUrl`, `paths`, `appName`, `locale`
    und `emailVerificationMode` als Parameter.

  - `AuthMailerConfig` und `CreateAuthMailerConfigArgs` Typen.

  Eliminiert Duplikate zwischen kumiko-studio, publicstatus und solon — jede
  App hatte identische `send*Email`-Wrapper × 4 kopiert.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.37.0
- @cosmicdrift/kumiko-dispatcher-live@0.37.0
- @cosmicdrift/kumiko-renderer@0.37.0
- @cosmicdrift/kumiko-renderer-web@0.37.0

## 0.36.0

### Patch Changes

- Updated dependencies [d84a515]
- Updated dependencies [1901bdf]
  - @cosmicdrift/kumiko-framework@0.36.0
  - @cosmicdrift/kumiko-renderer-web@0.36.0
  - @cosmicdrift/kumiko-renderer@0.36.0
  - @cosmicdrift/kumiko-dispatcher-live@0.36.0

## 0.35.0

### Patch Changes

- Updated dependencies [6553405]
  - @cosmicdrift/kumiko-framework@0.35.0
  - @cosmicdrift/kumiko-renderer-web@0.35.0
  - @cosmicdrift/kumiko-renderer@0.35.0
  - @cosmicdrift/kumiko-dispatcher-live@0.35.0

## 0.34.2

### Patch Changes

- ce4a16f: Set-Value-UI: gespeicherte customField-Werte beim Edit anzeigen (nicht write-only)

  Die `CustomFieldsFormSection` lud nur die Field-Definitionen, nie die
  gespeicherten Werte der Entity — die Inputs starteten beim Edit immer leer.
  Set-Value war damit „write-only": man konnte Werte setzen, sah den Bestand
  aber nie (Read-Back nach Reload war leer).

  Fix: `ExtensionSectionProps` bekommt `initialValues`; `EntityEditUpdateForm`
  reicht `record.customFields` (aus der detail-row) über `RenderEdit` an die
  Section durch. Die Section füllt die Inputs daraus, `pending` trackt nur
  Änderungen (Save bleibt bis zur ersten Eingabe disabled, nur geänderte
  Felder werden geschrieben). Folgt auf den create-mode-Fix (0.34.1).

- Updated dependencies [ce4a16f]
  - @cosmicdrift/kumiko-renderer@0.34.2
  - @cosmicdrift/kumiko-renderer-web@0.34.2
  - @cosmicdrift/kumiko-framework@0.34.2
  - @cosmicdrift/kumiko-dispatcher-live@0.34.2

## 0.34.1

### Patch Changes

- Updated dependencies [689133c]
  - @cosmicdrift/kumiko-renderer@0.34.1
  - @cosmicdrift/kumiko-renderer-web@0.34.1
  - @cosmicdrift/kumiko-framework@0.34.1
  - @cosmicdrift/kumiko-dispatcher-live@0.34.1

## 0.34.0

### Patch Changes

- Updated dependencies [9be544f]
  - @cosmicdrift/kumiko-framework@0.34.0
  - @cosmicdrift/kumiko-renderer@0.34.0
  - @cosmicdrift/kumiko-dispatcher-live@0.34.0
  - @cosmicdrift/kumiko-renderer-web@0.34.0

## 0.33.0

### Minor Changes

- 0bb1b92: custom-fields: neuer `update-tenant-field`-Write-Handler (Bug-Bash D2)

  Vollersatz-Edit für bestehende Field-Definitionen — Payload-Shape wie
  define, Identität via (entityName, fieldKey), `type` ist immutable
  (422 `field_type_immutable`; Type-Wechsel = delete + re-define).
  Kein delete+redefine im Update: Event-Historie und Field-Ids bleiben
  erhalten. QN: `custom-fields:write:update-tenant-field`.

### Patch Changes

- @cosmicdrift/kumiko-framework@0.33.0
- @cosmicdrift/kumiko-dispatcher-live@0.33.0
- @cosmicdrift/kumiko-renderer@0.33.0
- @cosmicdrift/kumiko-renderer-web@0.33.0

## 0.32.1

### Patch Changes

- Updated dependencies [b418259]
  - @cosmicdrift/kumiko-renderer@0.32.1
  - @cosmicdrift/kumiko-renderer-web@0.32.1
  - @cosmicdrift/kumiko-framework@0.32.1
  - @cosmicdrift/kumiko-dispatcher-live@0.32.1

## 0.32.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [5bb198b]
- Updated dependencies [05c4447]
- Updated dependencies [0009486]
  - @cosmicdrift/kumiko-renderer@0.32.0
  - @cosmicdrift/kumiko-renderer-web@0.32.0
  - @cosmicdrift/kumiko-framework@0.32.0
  - @cosmicdrift/kumiko-dispatcher-live@0.32.0

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
