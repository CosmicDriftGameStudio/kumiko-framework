---
status: parked
verified: 2026-06-07
evidence: Status-Box (line 572-590): alle Phasen 1-6 'pending'; Phase 0 und 7 'entfällt'. Drizzle-Session pausiert 2026-05-24. Git: commit 59107c3f phase-1 vorarbeit gestartet aber kein weiterer Fortschritt.
next: Bun-Migration erst angehen wenn Drizzle-Replacement 2.0 abgeschlossen ist (Sync-Punkt laut Plan)
---

# Bun-Cutover — yarn/vitest/node → bun (test/build/runtime)

**Stand:** 2026-05-24 (Plan), Start ausstehend.
**Aufwand:** 9-12 Tage Phase 2-5, +2-3 Tage optional Phase 6 (Single-Binary). Phase 7 entfällt — siehe unten.
**Worktree:** noch nicht angelegt.
**Ziel:** vollständiger Cut von yarn/vitest/node/vite zu Bun für test, build, runtime. Astro bleibt für docs/marketing übergangsweise.

## Reihenfolge-Entscheidung (2026-05-24)

Parallele Drizzle→bun.sql-Session wurde **am 2026-05-24 pausiert**. Stand der Session:
- ✅ Production-Code-Pfade auf Bun.sql migriert (`bun-db/connection.ts`, `migrate-runner.ts`, `entity-table-meta.ts`)
- ⏸ Test-Adapter WIP (postgres-js für Tests weil vitest unter Node läuft) — als lokaler Branch `drizzle-removal-wip` gesichert, nicht weitergeführt

**Begründung Pause:** vitest unter Node erzwingt postgres-js Test-Adapter. Nach Bun-Migration läuft bun test mit Bun.sql direkt — Adapter überflüssig. Reihenfolge-Umkehr spart ~3 Tage Arbeit:

```
ALT (verworfen):                       NEU (geplant):
  1. Drizzle → Bun.sql (Prod+Tests)      1. Bun-Migration (Phase 2-5)
     ↳ Tests brauchen postgres-js           ↳ Drizzle bleibt im Mix — läuft unter bun
  2. Bun-Migration                       2. Drizzle-Replacement 2.0
     ↳ überall postgres-js raus             ↳ Tests direkt mit Bun.sql, KEIN Adapter
  3. Phase 7 Cleanup
```

**Konsequenzen für diesen Plan:**
- Phase 0 (Drizzle-Sperre) entfällt — Production-Code-Stand wird übernommen, keine konkurrierende Session mehr
- Tests bleiben während Bun-Migration auf drizzle/postgres-js-Mix (so wie nach Production-Code-Migration jetzt) — wird in Phase 4 nur von vitest auf bun test umgestellt, Driver-Schicht unverändert
- Phase 7 (postgres-js → Bun.sql Konsolidierung) entfällt aus diesem Plan und wandert in die **Drizzle-Replacement 2.0 Session** nach Bun-Cutover
- WIP-Branch `drizzle-removal-wip` bleibt als Referenz für Schema-Meta-Designs und Migration-Runner-Patterns

## Wiedereinstiegs-Anker (für Pause-Resume)

Wenn du diesen Plan nach Pause wieder aufnimmst:
1. Prüfe Drizzle-Session-Status — `grep "drizzle-kit" packages/*/package.json` muss leer sein
2. Prüfe Worktree — `git worktree list` zeigt `kumiko-framework-bun-cutover`
3. Letzter abgeschlossener Schritt steht in der **Status-Box** am Ende des Plans
4. Nächster Schritt: erste pending Phase

---

## Warum

- vitest 4 ist OK, aber bun-test ist nativ, kein zusätzlicher Toolchain-Layer (kein vite-Bundler im Hot-Path der Tests).
- yarn-Berry war über die Repos-Cuts hinweg fragil (siehe Memos: yarn-NPM_AUTH_TOKEN, yarn berry symlinks, react-Duplikate, lockfile-Pain). bun.lock ist Text, diffbar, Workspace-Resolution einfacher.
- node 24 strippt TypeScript aus node_modules nicht — kollidiert mit Kumiko's "framework published TS as-is"-Linie. Bun resolved TS direkt, kein Build-Step für die Library nötig.
- Production-Image-Größen mit node-Stack ~1.5GB. Bun-Single-Binary 5-10× kleiner (Phase 6).

## Keine Sperre mehr

Drizzle-Session pausiert nach Production-Code-Migration (2026-05-24). Production-Code-Stand:
- `bun-db/connection.ts` — Bun.SQL primary, postgres-js als LISTEN/NOTIFY-Peer
- `db/connection.ts` (legacy) — bleibt vorerst für Tests aktiv
- `migrate-runner.ts` + `entity-table-meta.ts` — auf Bun.sql

Bun-Migration kann ohne Einschränkung jeden Pfad anfassen. Tests behalten ihre aktuelle DB-Driver-Mischung (drizzle/postgres-js) während der Bun-Migration — nur der Test-Runner wechselt (vitest → bun test), nicht der DB-Driver.

---

## Risiko-Sweep-Befunde (2026-05-23, vor Start verifiziert)

Alle in `/tmp/bun-risk/` durch echte Tests reproduziert. Tests nicht im Repo, Inhalt hier dokumentiert.

### 🟢 Grün (verifiziert)

| Punkt | Beweis | Befund |
|---|---|---|
| `vi.fn` → `mock()` | bun:test mock() + toHaveBeenCalledWith/Times | 1:1 mappbar |
| `vi.spyOn` → `spyOn()` + `mockRestore` | obj.method-Stubbing roundtrip | 1:1 mappbar |
| `vi.useFakeTimers` → `setSystemTime` | Date.now-Override + reset | identisch |
| `vi.mock` einfach → `mock.module` | 3 Files trivial migrierbar | grün |
| `vi.hoisted + vi.importActual` (komplex) | partial-mock via `await import + spread + mock.module` | 1:1 reproduzierbar — der gefürchtete Pattern ist gelöst |
| Snapshots `toMatch{Inline,}Snapshot` | bun schreibt in `__snapshots__/file.test.ts.snap` (gleicher Pfad) | einmaliger `bun test -u` reicht |
| Lifecycle `beforeAll/Each` + `afterAll/Each` | Hook-Order-Test grün | grün |
| `expect.{any,objectContaining,arrayContaining}` | alle drei | grün |
| `node:async_hooks` / AsyncLocalStorage | nested context + await propagation | grün (5 Stellen in framework — observability/context, span, db/event-store-executor, api/request-id-middleware, api/request-context) |
| Native: `@node-rs/argon2` (Rust-NAPI) | hash + verify roundtrip | grün — kritisch fürs auth-Feature |
| Native: `msgpackr-extract` (prebuilt) | `extractStrings`-Function | grün |
| Native: `pino` + `ioredis` | logger läuft | grün |
| `bun --filter='*' run check` | beide Workspaces ausgeführt | Drop-in für `yarn workspaces foreach -A` |
| `workspace:*` Protocol | Resolution funktioniert | grün (siehe gelb: Linker) |
| `bun test --changed` | bun --help bestätigt | sogar besser (commit/branch Compare) |
| `vitest globals: true` | überall trotzdem explizite Imports | Codemod-trivial |
| `node:vm`/`cluster`/`inspector` | **0 Treffer** im Code | kein Risiko |
| Radix DropdownMenu unter happy-dom | mit portierten Pointer-Capture-Polyfills geöffnet | grün — Phase 4d entfällt vermutlich |
| changesets + lint-staged via `bunx` | beide laden | grün |
| Dynamic Feature-Imports (Bundle-Killer) | 0 Template-String-Treffer, 9 Variable-Imports nur in CLI-Tools | Phase-6-Blocker aufgelöst |
| Single-Binary mit Hono+Zod+Pino+JOSE+argon2 | `bun build --compile` produziert 62MB binary, läuft ohne node_modules | grün |
| Cross-Compile macOS → linux-x64 | 91MB ELF binary, 4.3s build | grün |
| Embedded Asset-Imports (SQL/JSON) | `import x from "./y.sql" with { type: "text" }` | grün |

### 🟡 Gelb (funktioniert mit Anpassung)

| Punkt | Befund | Konkrete Anpassung |
|---|---|---|
| `link:./pfad` Protocol | Bun lehnt ab, will registry-style `bun link` | `"@app/define": "file:./.kumiko"` getestet, funktioniert. Caveat: `file:` kopiert, `link:` symlinkt — bei Codegen-Watch ggf. Stale-Drift, dann manuell `bun install` triggern oder `.kumiko` als echten Workspace einrichten. |
| Default-Linker = `isolated` | kein `node_modules/@scope/`-Symlink-Layout | `bunfig.toml`: `[install] linker = "hoisted"` (oder `--linker=hoisted`-Flag) — sonst brechen Tools die node_modules direkt scannen |
| `bunx playwright` startet Node, nicht Bun | Node 24 kann TS aus node_modules nicht strippen → kumiko-framework's TS-published Sources crashen den Config-Load | **`bunx --bun playwright test`** (mit `--bun` flag) — getestet, 17 Tests in 6 Files gelistet, kein Error. Muss in **alle** package.json scripts + CI. |
| Snapshot-Header-Format | `// Bun Snapshot v1` vs `// Vitest Snapshot v1` + trailing-comma-Drift | einmaliger `bun test -u` nach Migration, 4 betroffene Files manuell diffen |
| `mock.module` hoistet **NICHT** automatisch | Beweis: `getValue()` vor `mock.module(...)` returned "REAL" | Codemod muss `mock.module()` als erstes Statement nach Imports platzieren — in den 3 existierenden `vi.mock`-Files manuell prüfen |
| `dependenciesMeta.<pkg>.built: false` (yarn-only) | bun ignoriert | Migration: `trustedDependencies: []` in package.json (explizit leer = nichts ohne OK gebaut). Native-Module mit prebuilds laden trotzdem |
| `kumiko-legacy.ts` ruft `yarn vitest run` an ~6 Stellen | Phase-4-pre Pflicht | Vor Phase 4a: `yarn vitest run` → `bun test`, `node X.js` → `bun X.js`, `--config X` → `--preload X` mit Pattern |

### 🔴 Rot — keine offenen Probleme

Alle vormals roten Punkte sind durch echte Tests aufgelöst.

---

## Architektur-Entscheidungen für Phase 6

Vom User abgenommen am 2026-05-23:

1. **UI als Sidecar:** `dist/index.html + dist/assets/` neben dem Server-Binary. Image ~100-120MB (Faktor 12-15× kleiner als aktuelles ~1.5GB).
2. **Migration-SQL:** in Git als Source-of-Truth, im Prod-Binary embedded via `import x from "./drizzle/N.sql" with { type: "text" }`. Dev-Modus lädt von Disk. Migration-Runner muss beide Modi unterstützen — gehört in Drizzle→bun.sql-Session als Sync-Punkt.
3. **Feature-Registry static:** Boot-Validation registriert alles static, keine dynamic-import-Discovery. Verifiziert durch grep — 0 Template-String-Pattern-Treffer.
4. **Studio-Imports lokal vs CI:** Lokal nutzt Studio das workspace-linked framework (`workspace:*`) für DX. CI baut gegen npm-publishte Version. Phase-6-Single-Binary baut gegen npm-Version — kein Workspace-Source-Bundling-Risiko.

---

## Mechanische Änderungen (Codemod / ts-morph)

Der Großteil der Migration ist mechanisch automatisierbar. Ein paar Stellen brauchen manuelles Auge. Hier die Liste sortiert nach Tool und Risiko — wird pro Phase referenziert.

### Vollautomatisch via einfachem Search-and-Replace

Trivial-Codemod (z.B. `bun scripts/codemod-bun.ts` mit `Bun.glob` + `String.replaceAll`), kein AST nötig, KEIN Risiko Code zu zerstören:

| Pattern alt | Pattern neu | Files |
|---|---|---|
| `from "vitest"` | `from "bun:test"` | ~1750 |
| `from 'vitest'` | `from 'bun:test'` | (gleiche Files) |
| `vi.fn(` | `mock(` | 286 Treffer |
| `vi.spyOn` | `spyOn` | 16 Treffer |
| `vi.useFakeTimers(` | `useFakeTimers(` | 5 Treffer |
| `vi.setSystemTime(` | `setSystemTime(` | (in den 5) |
| `vi.advanceTimersByTime(` | `advanceTimersByTime(` | (in den 5) |
| `vi.restoreAllMocks(` | `mock.restore(` | manuell prüfen — semantisch nicht 1:1 in allen Fällen |
| `#!/usr/bin/env node` (eigene Files) | `#!/usr/bin/env bun` | Sweep nötig |
| `"test": "vitest"` | `"test": "bun test"` | ~10 package.json |
| `"test:run": "vitest run"` | `"test:run": "bun test"` | ~10 package.json |
| `yarn run -T playwright` | `bunx --bun playwright` | scripts |
| `yarn workspaces foreach -A` | `bun --filter='*'` | Root scripts |
| `dependenciesMeta`-Key | `trustedDependencies: []` | studio package.json + andere |
| `"link:./` (in publicstatus deps) | `"file:./` | publicstatus only |

**Import-Codemod muss Named-Imports erweitern,** weil bun-test andere Symbol-Namen exportiert. Beispiel:

```ts
// VORHER
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

// NACHHER (auto-codemod erweitert die Import-Liste)
import {
  describe, test, expect,
  mock, spyOn,                       // ersetzt vi.fn, vi.spyOn
  setSystemTime, useFakeTimers,      // ersetzt vi.useFakeTimers/setSystemTime
  beforeEach, afterEach,
} from "bun:test";
```

Heuristik im Codemod: zähle pro File welche `vi.*`-Calls vorkommen, generiere die korrespondierende Import-Liste.

### Automatisch via ts-morph (AST-basiert, semantik-bewusst)

Stellen wo Regex driften würde:

**(1) `vi.mock(path, factory)` → `mock.module(path, factory)` — mit Hoisting-Check**

5 Files (`codemod-pipeline.test.ts`, `editor-read-only.test.tsx`, `login-screen.test.tsx`, …). ts-morph soll:
- jeden `CallExpression` mit `vi.mock` finden
- prüfen ob danach Top-Level-Statements stehen die das Modul verwenden
- wenn ja → Warnung loggen, manuell prüfen
- wenn nein → Drop-in-Rename

Skeleton:
```ts
// scripts/codemod/vi-mock-to-bun.ts
import { Project, SyntaxKind } from "ts-morph";

const project = new Project({ tsConfigFilePath: "tsconfig.json" });
for (const sf of project.getSourceFiles("**/*.test.{ts,tsx}")) {
  const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter(c => c.getExpression().getText() === "vi.mock");
  for (const call of calls) {
    call.getExpression().replaceWithText("mock.module");
    // Hoisting-Check: ist `vi.mock` das ERSTE Statement nach Imports?
    const stmt = call.getFirstAncestorByKind(SyntaxKind.ExpressionStatement);
    const stmtIdx = stmt?.getChildIndex() ?? -1;
    // Imports + leerzeile = idx 0..N. Wenn weit dahinter → vorziehen oder warnen.
  }
  sf.saveSync();
}
```

**(2) `vi.hoisted(() => ({…})) + vi.mock(path, async () => { actual = await vi.importActual(…) })` → 3-Statement-Form**

NUR 1 File (`login-screen.test.tsx`), kostet 10 Minuten manuell. **ts-morph nicht lohnenswert** — ein einziges File, Code-Pattern siehe oben in Phase 4a.

**(3) `vi.fn<(x: string) => void>()` → `mock<(x: string) => void>()` mit Type-Argument-Preservation**

Naiver Regex (`vi\.fn\(` → `mock(`) verliert Type-Arguments nicht (sie stehen zwischen `vi.fn` und `(`). Test: `vi.fn<T>()` wird zu `mock<T>()` via simplen `vi\.fn` → `mock`-Replace. **Regex reicht hier**, ts-morph nicht nötig.

**(4) `vitest.config.ts` → `bunfig.toml` Übersetzung**

ts-morph liest `defineConfig({...})`, extrahiert `test.{include,exclude,setupFiles,env,testTimeout,poolOptions}`, schreibt äquivalentes TOML. Da nur ~10 Configs existieren: **manuell oder semi-automatisch** schneller als Codemod.

**(5) Alias-Resolver aus `vitest.config.ts` → `tsconfig.json` `paths`**

Aktuell in `vitest.config.ts`:
```ts
resolve: { alias: { "@cosmicdrift/kumiko-framework/engine": path.resolve(...) } }
```
muss zu `tsconfig.json`:
```json
{ "compilerOptions": { "paths": { "@cosmicdrift/kumiko-framework/engine": ["./packages/framework/src/engine"] } } }
```

ts-morph kann das, aber: 4 Configs (framework unit + integration, publicstatus, enterprise) — manuell schneller. Eintrag in Phase 4a als 5-Minuten-Task.

### CI-Workflows (yaml, kein TS-Codemod)

`.github/workflows/*.yml`:

```yaml
# VORHER
- uses: actions/setup-node@v4
  with: { node-version: '20', cache: 'yarn' }
- run: yarn install --immutable
- run: yarn kumiko check

# NACHHER
- uses: oven-sh/setup-bun@v2
  with: { bun-version: '1.3.14' }
- run: bun install --frozen-lockfile
- run: bun kumiko-framework/bin/kumiko.ts check
```

Plus Cache-Pfad-Update:
```yaml
# VORHER
path: |
  ~/.yarn/cache
  ~/.yarn/berry/cache
  .yarn/cache
key: yarn-${{ runner.os }}-${{ hashFiles('**/yarn.lock') }}

# NACHHER
path: ~/.bun/install/cache
key: bun-${{ runner.os }}-${{ hashFiles('**/bun.lock') }}
```

**Empfehlung:** sed-Script + manuelles Review der `.yml`-Files. Zu wenig Treffer (4 CI-Workflows) für eigenes Tool.

### Was NICHT mechanisch geht (manuell)

| Stelle | Warum manuell | Aufwand |
|---|---|---|
| `bin/kumiko-legacy.ts` Vitest-Aufrufe (Phase 4-pre) | ~6 Stellen mit `Bun.spawn`-Template-Strings + flags | ~1h |
| DOM-Polyfills (`vitest.setup.ts` → `test-setup/dom.preload.ts`) | 4 Zeilen Copy + Anpassung der Bedingung (happy-dom statt jsdom) | 5 Minuten pro Repo |
| Integration-Test `env: {…}` aus `vitest.integration.config.ts` → `preload.ts` mit `process.env.X = ...` | Pure Daten-Transformation, lohnt sich Codemod nicht | 10 Min pro Repo |
| `vitest.config.ts` `poolOptions.threads.maxThreads` → `bunfig.toml` `[test] concurrency = N` | semantik-different, manuell setzen | 5 Min pro Repo |
| `globalSetup` (publicstatus) → preload + separater Test-DB-Setup-Script | bun hat kein globalSetup-Pendant | 30 Min |
| 1 File mit `vi.hoisted+vi.importActual` | Eindeutig, Codemod-Skeleton oben | 10 Min manuell |
| 4 Snapshot-Files mit `bun test -u` neu generieren | One-shot, diff danach review | 15 Min |
| Astro-Cut für `website/` (Phase 5) | Architektur-Migration, kein mechanischer Pattern | siehe Phase 5 |
| Dockerfile / K8s-Helm-Values | Multi-Stage-Build, Image-Base, COPY-Pfade | ~1h pro App |

### Reihenfolge der mechanischen Änderungen

Pro Worktree-Branch:

```
1. scripts/codemod/01-imports.ts       # from "vitest" → "bun:test", erweitere Named-Imports
2. scripts/codemod/02-vi-fn-spyon.ts   # vi.fn → mock, vi.spyOn → spyOn (Regex reicht)
3. scripts/codemod/03-vi-mock.ts       # ts-morph, mit Hoisting-Warn-Liste
4. scripts/codemod/04-package-json.ts  # scripts + trustedDependencies + link:→file:
5. scripts/codemod/05-shebangs.ts      # #!/usr/bin/env node → bun
6. manual review: 03-vi-mock Warn-Liste (3-5 Files erwartet)
7. manual: kumiko-legacy.ts, bunfig.toml, tsconfig.paths
8. manual: GitHub Actions Workflows
9. bun test -u (Snapshot-Update)
10. bun test (Verifikation, Diff vs Baseline)
```

Codemods bleiben in `scripts/codemod/` nach Cutover als History — können später zur Migration weiterer Sub-Repos (z.B. space-conquest, das eigene Welt ist) wiederverwendet werden.

### Idempotenz-Anforderung

Jeder Codemod muss idempotent sein (zweimal laufen = einmal laufen). Begründung: bei Rebase gegen main können Files re-erscheinen mit alter API. Test im Codemod-Script:
```ts
// Nach jeder Transformation
assert(sf.getFullText().includes("from \"vitest\"") === false,
  `${path} still has vitest imports after codemod — fix the regex`);
```

---

## Phasen

### Phase 0 — ENTFÄLLT

Drizzle-Session pausiert (siehe Reihenfolge-Entscheidung oben). Direkter Sprung zu Phase 1.

### Phase 1 — Vorarbeit (~1 Tag)

- Worktree anlegen: `kumiko-framework-bun-cutover` (Branch von main nach Drizzle-Cut)
- Baseline-Snapshots aufnehmen pro Repo:
  - `yarn test:run 2>&1 | tee /tmp/baselines/<repo>-vitest.log`
  - `grep -E "(passed|skipped)" /tmp/baselines/<repo>-vitest.log` für DoD-Compare später
- Anti-Tests aufnehmen (alle 4 Bereiche sollen VOR Migration rot sein):
  - `bun test some.test.ts` → `vi is not defined`
  - `bun install --frozen-lockfile` → lockfile-mismatch
  - `grep -rl "env node" src/` → Liste >0
  - `bun pm ls website | grep vite` → Treffer

### Phase 1.5 — Node-API-Sweep + Native-Module-Inventar (~0.5 Tag)

- grep auf `node:vm`/`async_hooks`/`cluster`: schon gemacht, 0 Treffer für vm/cluster, 5 ALS-Stellen ok
- Native-Module-Liste: `@node-rs/argon2`, `msgpackr-extract` (transitive), `pino` (thread-stream). Alle getestet ✓
- `dependenciesMeta.built:false` → `trustedDependencies:[]`-Migration vorbereiten
- Output: ein Markdown mit Pre-Migration-Inventar (für später-Vergleich)

### Phase 2 — yarn → bun (~1 Tag)

**Schritte:**
- `bunfig.toml` an Root + Sub-Repos:
  ```toml
  [install]
  linker = "hoisted"
  [install.scopes]
  "@cosmicdrift" = { url = "https://npm.pkg.github.com", token = "$GITHUB_TOKEN" }
  ```
- `bun install` im Root → `bun.lock` (Text, diffbar)
- Root-`package.json`: `yarn workspaces foreach -A run X` → `bun --filter='kumiko-*' run X`
- CI-Workflows aktualisieren: `actions/setup-node` raus, `oven-sh/setup-bun@v2` rein, Cache-Pfad `~/.bun/install/cache`
- `yarn.lock` + `.yarnrc.yml` entfernen
- `packageManager`-Felder raus (Corepack akzeptiert "bun" nicht offiziell)
- publicstatus's `"@app/define": "link:./.kumiko"` → `"file:./.kumiko"`

**Verifikation (Phase-2-DoD):**
- `bun install --frozen-lockfile` 2× exit 0 (deterministische Resolution)
- `cd publicstatus && bun -e 'console.log(require.resolve("@cosmicdrift/kumiko-framework"))'` zeigt Workspace-Pfad
- `bun --filter='kumiko-*' run typecheck` durch in jedem kumiko-* Repo

### Phase 3 — node → bun Runtime (~0.5 Tag)

**Schritte:**
- Shebang-Sweep: `#!/usr/bin/env node` → `#!/usr/bin/env bun` in eigenen Files
- Dockerfiles: `node:20-alpine` → `oven/bun:1.3-alpine`. `kumiko-platform/infra/build-image/` prüfen ob Prebuild-Image schon `oven/bun:1` ist (siehe Memo: CDGS-CLI-Image)
- CI: alle `setup-node` raus, `NODE_OPTIONS=--no-deprecation` aus scripts raus
- `package.json` scripts die `node X.ts` rufen → `bun X.ts`

**Verifikation:**
- Sweep `grep -rl "^#!/usr/bin/env node"` ist leer (kein eigener Code-Treffer)
- Dev-Smoke pro App: `PORT=4190 bun --env-file=../.env run kumiko-dev bin/server.ts` + `curl http://localhost:4190/api/health` returns 200

### Phase 3.5 — Tooling-Drumherum (~0.5 Tag)

**Schritte:**
- husky-Hooks: `prepare`-Script bleibt, Hooks selbst rufen `bun lint-staged` (statt yarn)
- lint-staged: `bunx lint-staged` (getestet, lädt)
- changesets: `bunx changeset` (getestet, 2.31.0 lädt)
- Bun-Version pinnen: in CI `bun-version: 1.3.14` (sonst CI-Drift bei Bun-Releases)
- `.env`-Loading-Reihenfolge prüfen (Bun: .env → .env.production → .env.local → .env.<NODE_ENV>.local)

**Verifikation:**
- `bunx changeset --version` + `bunx lint-staged --version` exit 0
- Husky-Hook bei lokalem Commit greift (manuell)

### Phase 4-pre — kumiko-check Interna umstellen (~0.5 Tag) [BLOCKER für Phase 4a]

Vor Phase 4a: `bin/kumiko-legacy.ts` (~6 Stellen) muss `yarn vitest run` → `bun test` ersetzen. Konkrete Stellen aus grep:
- Line 109: `const VITEST = join(BIN_PATH, "vitest")` → unused / oder `"bun"`
- Lines 405-411: `$\`node vitest.integration.guard.js\`` → `$\`bun vitest.integration.guard.js\``, `$\`yarn vitest run ...\`` → `$\`bun test ...\``
- Lines 447-449: `$\`yarn vitest run ${scope}\`` → `$\`bun test ${scope}\``
- Line 529: `Bun.spawn(["sh", "-c", "KUMIKO_CHECK=1 yarn vitest run --changed"])` → `bun test --changed`

**Verifikation:**
- `bun kumiko-framework/bin/kumiko.ts check --fast` läuft ohne `yarn vitest`-Call
- Trace: `grep "yarn vitest\|vitest run" kumiko-framework/bin/kumiko-legacy.ts` ist leer

### Phase 4a — vitest → bun test (Unit) (~2-3 Tage)

**Reihenfolge:** framework → publicstatus → studio → enterprise (Größe-absteigend, größter Lern-ROI zuerst).

**Pro Repo:**
- `bunfig.toml` `[test]` section (preload, timeout, env-Vars)
- Codemod: `import { ... } from "vitest"` → `from "bun:test"`; `vi.fn` → `mock`; `vi.spyOn` → `spyOn`; `vi.useFakeTimers/setSystemTime` → `setSystemTime`
- 3 Files mit `vi.mock` + 1 mit `vi.hoisted` manuell — siehe Code-Snippet unten
- DOM-Tests (28 Files): `vitest.setup.ts` Polyfills nach `test-setup/dom.preload.ts` portieren, `bun test --env happy-dom`
- `package.json` scripts: `vitest run` → `bun test`
- `vitest.config.ts` + `vitest.setup.ts` entfernen
- Einmaliger `bun test -u` für die 4 Snapshot-Files

**Codemod-Pattern für `vi.hoisted + vi.importActual` (Beispiel: login-screen.test.tsx):**
```ts
// VORHER
const { requestEmailVerificationMock } = vi.hoisted(() => ({
  requestEmailVerificationMock: vi.fn(),
}));
vi.mock("../auth-client", async () => {
  const actual = await vi.importActual<typeof import("../auth-client")>("../auth-client");
  return { ...actual, requestEmailVerification: requestEmailVerificationMock };
});

// NACHHER
const requestEmailVerificationMock = mock(() => undefined);
const actual = await import("../auth-client");
mock.module("../auth-client", () => ({
  ...actual,
  requestEmailVerification: requestEmailVerificationMock,
}));
```

**Verifikation (pro Repo):**
- Test-Count identisch vs Baseline (`diff <(grep -E "passed|skipped" /tmp/baselines/<repo>-vitest.log) <(bun test 2>&1 | grep -E "pass|fail")`)
- DoD: keine "module not found", keine silent-ignored vi.mock-Calls

### Phase 4.5 — solon + sample-apps + sample-recipes (~1 Tag)

**Scope:**
- `solon/runner/` Workspace
- `kumiko-framework/samples/apps/*` (~10 Apps)
- `kumiko-framework/samples/recipes/*` (eigene vitest.configs für pipeline-basics, webhook-step)

Codemod gleich wie 4a. Eigene vitest.configs in recipes ablösen (siehe Memo: feedback_workspace_swap_hides_drift).

### Phase 4b — Integration-Tests (~1 Tag)

**Schritte:**
- Eigene `test-setup/integration.preload.ts` mit allen env-Vars (DATABASE_URL, REDIS_URL, MEILI_URL, MINIO_*, JWT_*)
- `package.json` scripts:
  ```json
  "test:integration": "bun test --preload ./test-setup/integration.preload.ts 'packages/**/*.integration.ts'"
  ```
- `concurrency: 3` (DB-Pool, ersetzt `poolOptions.threads.maxThreads: 3`)
- `setupTestStack` unverändert (memo: feedback_no_fake_dispatcher)
- Bun hat kein 1:1 `globalSetup`-Pendant: wenn DB-Schema einmalig migriert werden muss → separater Step vor `bun test` (`bun scripts/test-db-setup.ts && bun test ...`)

**Verifikation:**
- Test-Counts identisch vs `vitest.integration.config.ts`-Baseline
- Anti-Test: `! grep -rn "createTestDispatcher" packages/ samples/` (Drift-Check)
- Docker-Compose-Stack (Postgres+Redis+Meili+Minio) läuft

### Phase 4c — Playwright unter bun (~0.5 Tag)

**Schritte:**
- `package.json` scripts: `yarn run -T playwright test` → `bunx --bun playwright test` (mit `--bun` flag, kritisch!)
- CI: `bunx --bun playwright install --with-deps chromium`
- `playwright.config.ts` Load-Test pro Repo (studio, publicstatus)

**Verifikation:**
- `bunx --bun playwright test --list` zeigt gleiche Test-Count wie vorher
- Voller e2e-Run grün

### Phase 4d — DOM-Eskalation (~0-1 Tag, optional)

**Plan A (erwartet):** Alle 28 DOM-Tests grün mit happy-dom + portierten Polyfills. Risiko-Sweep zeigte: 0 Tests referenzieren direkt Radix-APIs, Polyfills decken indirekten Bedarf ab.

**Plan B (falls einzelne rot):** Gezielt zu Playwright Component Tests umziehen. Aufwand ~2-4h pro Test.

### Phase 5 — Astro/Vite-Cut für `website/` (phased) (~0.5 Tag)

**Scope (jetzt):** Nur `website/` (klein). `kumiko-platform/apps/{docs,marketing}` bleiben übergangsweise auf Astro (Vite läuft weiter als Astro-internal).

**Schritte:**
- `scripts/build-site.ts` mit `Bun.build` + `marked` + `shiki` + `pagefind`
- Astro-Layout-Components → React-Components oder pures HTML-Template
- Output bleibt static `dist/`, Nginx-Container unverändert

**Verifikation:**
- `bun pm ls website | grep vite` ist leer
- `dist/index.html` existiert, opens in Browser

**Späterer Sprint (separat):** docs + marketing Astro-Cut (~2-3 Wochen).

### Phase 7 — ENTFÄLLT

Wandert in die **Drizzle-Replacement 2.0 Session** nach Bun-Cutover. Die Begründung war: postgres-js wurde nur deshalb in der Drizzle-Session aufgebaut, weil vitest unter Node lief. Mit Bun-Test ist Bun.sql direkt nutzbar, Tests können von Anfang an den Production-Driver verwenden.

**Was die 2.0-Session machen wird** (nicht Teil dieses Plans):
- Tests: drizzle/postgres-js → Bun.sql
- Legacy `db/connection.ts` + `stack/db.ts` entfernen
- `cleanup-test-dbs.ts` auf Bun.sql
- `bun-db/connection.ts` LISTEN/NOTIFY-Peer prüfen (Bun.sql.listen Smoke-Test unter Last)
- `package.json` `"postgres"` dependency entfernen (oder behalten falls LISTEN-Peer bleibt)

Original Phase 7-Sektion (Detail-Plan für die 2.0-Session) folgt unten als Referenz.

---

#### Referenz: postgres-js → bun.sql Consolidation (Plan-Material für Drizzle-Replacement 2.0)

**Hintergrund:** Während der parallelen Drizzle→bun.sql-Session musste postgres-js (`"postgres": "^3.4.9"`) als Peer-Driver bestehen bleiben, weil vitest unter Node läuft und Bun.sql Bun-only ist. Nach Phase 4a/b (vitest → bun test) ist diese Sperre weg — Tests laufen mit Bun und können Bun.sql direkt nutzen.

**Aktueller Bestand (2026-05-24):**
- `kumiko-framework/packages/framework/src/bun-db/connection.ts` — Bun.SQL-Pfad (Prod), nutzt postgres-js NUR für LISTEN/NOTIFY
- `kumiko-framework/packages/framework/src/db/connection.ts` (legacy) — pure postgres-js, schritt-für-schritt-Migration nicht fertig
- `kumiko-framework/packages/framework/src/stack/db.ts` — Stack-Composition mit postgres-js
- `scripts/cleanup-test-dbs.ts` — Test-DB-Cleanup via postgres-js
- `packages/dev-server/src/__tests__/run-prod-app.integration.ts` — Test mit postgres-js (klassischer Pain-Punkt)
- `packages/framework/package.json` — `"postgres": "^3.4.9"` dependency

**Konsolidierungs-Ziele:**

| Stelle | Was tun | Begründung |
|---|---|---|
| `db/connection.ts` (legacy) + `stack/db.ts` | entfernen, alle Konsumenten auf `bun-db/connection` umstellen | nach Phase 4 sind Tests grün, kein Bedarf mehr |
| `scripts/cleanup-test-dbs.ts` | `postgres()` → `Bun.sql` | bun läuft jetzt überall |
| Integration-Test postgres-js-Aufrufe | auf Bun.sql umstellen | bun test kann das jetzt |
| `bun-db/connection.ts` LISTEN/NOTIFY-Peer | **prüfen** ob `Bun.sql.listen()` production-ready | Reduktion auf single-Driver |
| `package.json` `"postgres"` dependency | entfernen | nur noch wenn LISTEN-Peer bleibt |

**LISTEN/NOTIFY-Entscheidung:**
- Bun.sql hat `.listen(channel, callback)` seit Bun 1.2.x
- Kritische Frage: Reconnect-Verhalten bei DB-Connection-Verlust, Backpressure bei vielen Notifies
- **Smoke-Test in Phase 7:** SSE-Stream mit Bun.sql.listen unter Last (100 NOTIFYs/sec, kill DB, restart)
- Wenn unstable → postgres-js bleibt für LISTEN-Peer (1 File, kontrollierter Scope), Rest weg
- Wenn stable → postgres-js komplett raus

**Schritte:**
1. Smoke-Test `Bun.sql.listen` unter Last + Reconnect (1 Tag)
2. Konsumenten von `db/connection.ts` enumerieren → auf `bun-db/connection` umstellen
3. `cleanup-test-dbs.ts` + integration-tests umstellen (mechanisch — `postgres()` → `Bun.sql` mit ähnlicher API)
4. Legacy-Files (`db/connection.ts`, `stack/db.ts`) entfernen
5. `bun-db/connection.ts` LISTEN-Peer-Pfad konsolidieren (oder behalten je nach Smoke-Resultat)
6. `package.json` `"postgres"` dependency entfernen (oder behalten falls Peer)
7. `yarn check` / `bun kumiko check` grün

**Verifikation:**
- `grep -rn "from \"postgres\"" packages/framework/src/` ist leer (oder NUR `bun-db/connection.ts` falls Peer behalten)
- Integration-Tests grün
- SSE-Realtime-E2E grün (publicstatus signup-flow.spec.ts)
- Image-Size-Reduktion: `bun pm ls | grep postgres` zeigt 0 (falls komplett raus)

**Sync-Punkt mit Drizzle-Session:**
- Was sie über bun-db/connection.ts API-Surface geschrieben hat ist bindend — diese Phase ändert nur Konsumenten, nicht die Bun.SQL-Wrapper-API
- Falls in der Drizzle-Session andere postgres-js-Peer-Files entstanden sind (z.B. SSE-Broker?), in dieser Phase mit-enumerieren

### Phase 6 — Production-Single-Binary (post-cutover, ~2-3 Tage, optional)

**Voraussetzung:** Phase 2-5 grün, Drizzle→bun.sql durch.

**Scope:**
- `kumiko-studio` Server-Binary + `dist/`-Sidecar
- `publicstatus` Server-Binary + `dist/`-Sidecar
- `solon-runner` Single-Binary

**Architektur:**
- `bun build --compile --minify --sourcemap --target=bun-linux-x64 ./bin/server.ts --outfile=./dist-server`
- SPA-Assets als Sidecar (`COPY dist/ /app/dist/` + `COPY server-binary /app/server`)
- Migration-SQL embedded via Text-Import (Sync-Punkt mit Drizzle-Session)
- Image-Größen-Ziel: < 200MB pro App

**Verifikation:**
- K3s-Deploy studio + publicstatus läuft
- Image-Size-Check (`docker images | grep studio`): < 200MB
- E2E gegen Image grün

---

## Sync-Punkte mit Drizzle→bun.sql-Session

1. Migration-Runner muss zwei Modi unterstützen:
   - **Dev:** `loadMigrationsFromDisk(migrationsDir)`
   - **Prod (Phase 6):** static `import sql0001 from "./drizzle/0001-init.sql" with { type: "text" }` Array
2. `drizzle/`-Folder bleibt als Source-of-Truth (Git-checked-in)
3. `dependenciesMeta.<pkg>.built:false` entscheidung gehört zur Drizzle-Session (welche native-deps bleiben?)

---

## Status-Box

| Phase | Status | Datum |
|---|---|---|
| 0 — Drizzle-Sync | **entfällt** (Drizzle-Session pausiert, Reihenfolge umgekehrt) | 2026-05-24 |
| 1 — Vorarbeit | pending | — |
| 1.5 — Sweep | teilweise gemacht (Risiko-Sweep im Plan) | 2026-05-23 |
| 2 — yarn → bun | pending | — |
| 3 — node → bun | pending | — |
| 3.5 — Tooling | pending | — |
| 4-pre — kumiko-check | pending | — |
| 4a — Unit-Tests | pending | — |
| 4.5 — solon/samples | pending | — |
| 4b — Integration | pending | — |
| 4c — Playwright | pending | — |
| 4d — DOM-Eskalation | pending (vermutlich entfällt) | — |
| 5 — website Astro-Cut | pending | — |
| 6 — Single-Binary | pending (optional, post-cutover) | — |
| 7 — postgres-js → bun.sql | **entfällt** (wandert in Drizzle-Replacement 2.0) | 2026-05-24 |

---

## Notes / Out-of-Scope

- `kumiko-platform/apps/docs` + `apps/marketing` Astro-Cut: separater Sprint nach Phase 5
- VS Code TypeScript-Server-Konflikt zwischen `bun-types` und `@types/node`: vermutlich kein Issue, in Phase 4a beobachten
- Source-Maps für Sentry: `--sourcemap`-Flag in Phase 3 + 6 setzen, Sentry-Konfig prüfen
- `bun audit`: in Phase 2 als CI-Step ergänzen (Pendant zu `npm audit`)
