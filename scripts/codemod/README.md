# bun-cutover codemods

Mechanische Migration vitest → bun:test, yarn → bun. Siehe Plan-Doc
`kumiko-platform/docs/plans/migration/bun-cutover.md`.

## Reihenfolge (pro Repo)

```bash
# 1. Imports umbiegen + Named-Import-Listen erweitern
bun scripts/codemod/01-imports.ts

# 2. vi.fn / vi.spyOn / vi.useFakeTimers → bun:test-Equivalents
bun scripts/codemod/02-vi-fn-spyon.ts

# 3. vi.mock → mock.module mit Hoisting-Check (gibt Warn-Liste)
bun scripts/codemod/03-vi-mock.ts

# 4. package.json scripts + trustedDependencies + link:→file:
bun scripts/codemod/04-package-json.ts

# 5. Shebangs #!/usr/bin/env node → bun
bun scripts/codemod/05-shebangs.ts

# Manual:
# - 03-Warn-Liste durchgehen (5 Files erwartet, vi.hoisted-Pattern)
# - bunfig.toml aus templates/ kopieren + anpassen
# - vitest.config.ts entfernen
# - vitest.setup.ts → test-setup/unit.preload.ts kopieren
# - bun test -u (Snapshots)
# - bun test (Verifikation, Diff vs Baseline)
```

## Idempotenz

Alle Codemods müssen idempotent sein — 2× laufen = 1× laufen. Bei Rebase
gegen main können Files re-erscheinen mit alter API. Tests im Code prüfen
nach jeder Transform dass Pattern-Reste leer sind.

## Templates

`templates/`:
- `bunfig.unit.toml` — Unit-Test bunfig (preload, timeout, env)
- `bunfig.integration.toml` — Integration-Test bunfig
- `unit.preload.ts` — happy-dom + Temporal-Polyfill + Radix-Pointer-Capture-Polyfill
- `integration.preload.ts` — env-Var-Setup (DB, Redis, Meili, Minio, JWT)

## pii-personal-migration.ts

Migrates `create*Field(...)` calls from the old flag-based PII API (`pii`,
`userOwned`, `tenantOwned`, `subjectRef`, `allowPlaintext`, `lookupable`,
`searchable`, `sensitive`) to the author-facing `personal`/`find` API
(kumiko-framework#2250). Idempotent — safe to re-run against already
migrated code (no-ops on fields carrying `personal`).

`createTenantConfig`/`createUserConfig`/etc. are out of scope by
construction (name doesn't match `create*Field`).

```bash
bun scripts/codemod/pii-personal-migration.ts <targetDir> [--dry-run]
```

Anything it can't map mechanically (two subject flags on one field,
`sensitive` + `lookupable`/`searchable` together, `piiEncrypted` on an
entity field, a raw object literal with subject flags outside a
`create*Field(...)` call) is reported with file:line instead of guessed
at — fix those by hand. The report also lists every field that newly
gains `lookupable` (searchable-only fields resolving to `find: "fuzzy"`)
— each of those needs a `_bidx` column migration, which this script does
not write.
