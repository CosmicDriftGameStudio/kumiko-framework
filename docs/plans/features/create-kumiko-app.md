---
status: in-progress
verified: 2026-07-20
evidence: 2026-06-21 grep `kumiko-framework/packages/cli/src/` findet keinen scaffold/init/create-Command; npm-registry `npm view create-kumiko-app` müsste geprüft werden (vermutlich frei); Marketing-Hero `apps/marketing/src/pages/index.astro` zeigt aktuell keinen „leer → läuft"-Moment, sondern Feature-Listen + Showcase-Karten; Marc-Feedback 2026-06-21 „jeder den ich kumiko zeig sagt er versteht nicht was es macht, nicht mal ein programmierer"; Diskussion 2026-06-21: GIF im Hero (CLI links + Browser rechts) inkl. Add-Feature-Moment als Wow-Story benötigt zuerst den Scaffold-Flow als real ausführbares Artefakt. `kumiko-framework/packages/dev-server/` hat keinen `--hot`/Watch-Reload-Pfad — Phase 2 muss Bun-`--hot` o.ä. validieren. 2026-06-21 (Update): D3-Flip (Picker JA statt nein), D9 (Manifest-driven), D10 (Demo-Framework als Pattern für N Demos), D11 (Captions statt Voice) ergänzt — `samples/apps/use-all-bundled/feature-manifest.json` (41 Features) existiert bereits als Single-Source-of-Truth, fehlende UI-Hints werden via `defineFeature.manifestHints` ergänzt. 2026-06-21 (Update 2): D12 (`config`/`secrets` als Picker-Opt-In mit Backend-Wahl env/db/hybrid) + D13 (Scope-Hierarchie als Manifest-Detail mit `configKeys.seedDefault`/`scopes`/`sensitive` — NICHT als Picker-Frage, weil initial keine user/tenant-Keys gesetzt werden; Scope-Switching ist Runtime). Phase 1a +0.5 d (Validator + Config-Annotations), Phase 1b +0.5 d (Config-Key-Routing + README-Generator). Gesamt: ~6.5 d. 2026-06-21 (Update 3): D14 (`curl -fsSL kumiko.rocks/install.sh | bash`-One-Liner — Industriestandard wie rustup/deno/bun) + Phase 2b (install.sh als static asset auf marketing-site, Bun-Auto-Install bei Bedarf). Demo-Hero zeigt jetzt One-Liner statt `bun create`. Phase 2b +0.5 d. Gesamt: ~7 d.
issue: kumiko-framework#563
next: Phase 3 (Hero-GIF via `scripts/demos/` + `record-demo.ts`, de+en, Captions-Layer) + Pfad-Drift auflösen: `en/quickstart/quickstart.md` nutzt noch `bunx @cosmicdrift/kumiko-cli new app`, Marketing-Hero wirbt seit 2026-07-20 für den curl-One-Liner → ein Scaffold-Pfad als kanonisch festlegen und Docs angleichen. 2026-07-20 Befund: Phase 1a gebaut (`feature-manifest.json` mit 51× displayLabel/manifestHints), Phase 1b gebaut + publisht (npm `create-kumiko-app@0.4.134`, Package mit picker/dep-resolver/manifest-drift/yes-scaffold-boot-Tests), Phase 2b gebaut (`apps/marketing/public/install.sh` live-fähig), npm-Namespace gesichert, Phase 3 NICHT gebaut (kein GIF-Asset in `apps/marketing/public/`, Hero ist Text-Strip).
---

# Plan: `bun create kumiko-app` + 60s-Hero-Demo

## Problem

Wer Kumiko zum ersten Mal sieht, hat keinen **„leer → läuft"-Moment**:

- Kein npm-Scaffolder. `bun create kumiko-app` löst auf nichts auf.
- Kein ausführbarer First-Run-Walkthrough.
- Kein Marketing-Hero, der in 60s „leer → Login → erstes Custom-Feature" zeigt.

Sample-Apps (`samples/apps/marketing`, `cap-billing`, …) sind als git-Refs nutzbar,
aber ein Programmierer, der CashColt sieht und denkt „cool — wie fang ich an?",
findet keine 1-Befehls-Antwort. Konkurrenz (Next.js, Astro, Remix, RedwoodJS) hat
alle `create-`-CLIs als Eintrittspunkt — Kumiko fehlt das Standard-Onboarding-Gate.

## Ziel

**Ein `create-kumiko-app`-npm-Paket** + **eine 60s-Demo-Story**, die der Scaffolder
real durchspielt und die als GIF im Marketing-Hero läuft:

```
$ bun create kumiko-app demo
✓ Scaffolded demo/
$ cd demo && bun dev
✓ docker compose up (pg + redis)
✓ Migrations applied
✓ Admin seeded: admin@demo.test / changeme
✓ http://localhost:3000
```

→ Browser öffnet auf Login, Login klickt sich, dann der **Add-Feature-Moment**:
ein Editor öffnet `src/features/notes.ts`, fügt 6 Zeilen `defineFeature(...)` hinzu,
speichert; Reload erkennt den Add, Browser zeigt einen neuen CRUD-Screen „Notes"
in der Sidebar.

Das ist der Hero. Das Recording-Skript ist Artefakt **dieses** Plans, nicht
Nachgedanke — sonst lügt das Marketing.

## Non-Ziele

- Keine eigene DB-Provisioning. `docker compose up -d` ist der Pre-Step.
- Keine Multi-Template-Auswahl. Ein Template, sauber. Wer Custom braucht → Sample-App forken.
- Kein .env-Management-Magic. Generieren, Datei reinschreiben, Nutzer kennt sie.
- Keine GUI/TUI. Nur CLI-Output (Inquirer-Prompts sind CLI, kein TUI).
- Kein hand-gepflegter Feature-Katalog im Scaffolder. Picker-Optionen kommen
  ausschließlich aus `feature-manifest.json` (s. D9) — nie aus einer
  Scaffolder-internen Liste.

## Design-Entscheidungen

### D1 — npm-Paketname *(Blocker)*

`bun create <x>` löst zu `bunx create-<x>` auf. Paketname → **`create-kumiko-app`**,
unscoped. Begründung: `bun create @cosmicdrift/kumiko-app` ist hässlich und bricht
die Hero-Story. Falls Namespace belegt: Fallback **`create-kumiko`** (`bun create kumiko ...`).

Veröffentlichung im selben Lockstep-Release wie `@cosmicdrift/kumiko-framework`
(Changeset-Group), damit Template-pinned Versionen nie der live-Framework-Version
voraus oder hinterher sind.

### D2 — Template-Strategie *(High)*

Alternativen:
- **A)** Eigener Generator in TS (`fs.cp` + Variable-Replace via Mustache/EJS)
- B) `degit` / `giget` (git-Subtree-Fetch von Template-URL)
- C) `samples/apps/<x>` als Template referenzieren

**Entscheidung: A.**
- Kein git/network-Dependency (offline funktioniert)
- Volle Kontrolle über Variable-Substitution (Projektname in `package.json`,
  JWT-Secret generieren, `.env`, README mit lokalen Pfaden)
- Template lebt im Paket (`packages/create-kumiko-app/template/`) → Lockstep
  zur Framework-Version garantiert
- B/C: bei jeder Framework-Minor-Bump kann das Template gegen die falsche Version
  pinnen; bei A wird es per `dependencies` desselben Paket-Tags mit-bewegt

### D3 — Scaffolded-Inhalt *(High)*

Picker-Auswahl (s. D9) wird in `bin/main.ts` zu `composeFeatures([...])` gerendert.
Bei „defaults annehmen" (Enter durch alle Prompts) ist der Stack:

Minimal-Set:
- `bin/main.ts` — `composeFeatures` + `runDevApp`. Default-Stack (alle
  `recommended: true` aus dem Manifest): `tenant`, `user`, `sessions`,
  `auth-email-password`, `user-profile`, `files`, `delivery`,
  `mail-transport-inmemory`, `tier-engine`. *Kein* `billing`, *kein* `compliance`
  (`recommended: false` — opt-in via Picker).
- `bin/server.ts` — Boot-Pfad, Multi-Host-Default
- `src/features/notes.ts` — leer, mit Comment-Stub. Der Add-Feature-Moment in
  der Demo schreibt diese Datei.
- `package.json` — pinned `@cosmicdrift/kumiko-*`-Versionen, scripts: `dev`,
  `test`, `check`
- `tsconfig.json`, `biome.json`, `bunfig.toml`
- `docker-compose.yml` — pg + redis, deterministische Ports (55432 / 56379 wie Samples)
- `.env.example` + auto-generierte `.env`
- `README.md` — 3 Befehle, Link zu docs.kumiko.rocks/quickstart

### D4 — First-Run-Welcome-Banner *(Medium)*

`bun dev` darf nicht „Server läuft auf :3000" sagen und Schluss. Statt:
```
┌──────────────────────────────────────────────────────────────┐
│  ✓ kumiko-app läuft                                          │
│  → Browser:    http://localhost:3000                         │
│  → Login als:  admin@demo.test / changeme                    │
│  → Feature hinzufügen: edit src/features/notes.ts            │
│  → Docs:       https://docs.kumiko.rocks/quickstart          │
└──────────────────────────────────────────────────────────────┘
```

Implementiert in `runDevApp` als **`welcomeBanner`-Option** (default off, im
Scaffold-Template auf on). So profitieren auch bestehende Apps.

### D5 — Add-Feature-Demo-Skript *(High)*

Der Add-Feature-Moment ist der **eigentliche Wow** — Login alleine reicht nicht
(Auth0 kann das auch). Das Skript schreibt:

```ts
// src/features/notes.ts
import { defineFeature } from "@cosmicdrift/kumiko-framework";

export const notesFeature = defineFeature("notes", (r) => {
  r.entity("note", {
    fields: {
      title: r.text().required(),
      body: r.text(),
    },
  });
});
```

Dann patcht es `bin/main.ts`:
```ts
import { notesFeature } from "./src/features/notes";
// ... composeFeatures([..., notesFeature()], ...)
```

→ Reload erkennt File-Adds → DB-Migration läuft → Sidebar zeigt „Notes" → CRUD-Screen rendert.

### D6 — Hot-Reload-Pfad *(High — Risiko)*

`kumiko-framework/packages/dev-server/` hat aktuell **keinen Watch-Reload**.
`composeFeatures` läuft beim Boot — Feature-Adds erfordern Re-Boot.

Optionen für die Demo:
- **A)** `bun --hot bin/main.ts`: Bun's HMR triggert kompletten Re-Run des
  Entry-Modules → composeFeatures läuft neu → ~1s Reboot. Akzeptabel im GIF
  (Snappy genug, nicht magisch). Kein Framework-Code nötig.
- B) Echtes Feature-Hot-Reload (Watch + selektives Re-Compose ohne Server-Restart) →
  framework-internes Re-Wiring, deutlich aufwendiger, eigenes Plan-Doc wenn überhaupt.
- C) Im GIF Reboot kaschieren („Editor speichert → Browser-Spinner 1s → Notes da")

**Entscheidung: A.** `bun --hot` ist der idiomatic-Pfad, ~1s Reboot ist OK,
keine Framework-Investition nötig. Validator in Phase 2: prüfen, dass DB-Auto-Migration
beim Re-Boot ohne manuelle CLI-Intervention durchläuft (sonst lügt das Skript).

### D7 — DB-Default: Postgres + Redis via Docker *(Medium)*

SQLite wäre niedrigere Hürde, aber:
- Multi-Tenant + Event-Sourcing + JSON-Felder funktionieren teils nicht/schlecht auf SQLite
- Production-Diff zwischen Dev und Prod = Falle
- `docker compose up -d` ist ein einmaliger Befehl, kein Hindernis

**Entscheidung: Postgres + Redis via `docker-compose.yml`** im Template.
`bun dev` führt `docker compose up -d --wait` als Pre-Step aus. Wer kein Docker
hat → manuell + ENV-Vars, dokumentiert im README.

### D8 — Demo-Recording-Pipeline *(Medium)*

Split-Screen-GIF (CLI links, Browser rechts) wird gebraucht. Optionen:

| Option | Wie | Aufwand | Trade-off |
|---|---|---|---|
| **A: tmux + headed Playwright im selben Window-Capture** | Ein `screencapture -v` / ffmpeg → ein synchronisiertes Video | mittel | macOS-only, Window-Anordnung fragil aber sync-frei |
| B: Charm VHS (links) + Playwright-Video (rechts), `ffmpeg hstack` | Zwei isolierte Recordings, programmatisch gemergt | hoch | Sync zwischen den Streams handgenau |
| C: rrweb (Browser) + asciinema (CLI) → custom HTML-Player auf Marketing-Site | Web-native, klickbar, kein GIF | sehr hoch | bestes Endprodukt, eigenes Engineering |

**Entscheidung: A für v1.** GIF ist gut genug für den Hero, C ist Folge-Iteration
nach Validation. Recording-Skript `scripts/record-demo.ts`:
- Orchestriert tmux-Layout (2 panes nebeneinander, fixe Geometrie)
- Linker Pane: typt Befehle via `tmux send-keys` mit künstlichen Tipppausen
- Rechter Pane: chromium headed via Playwright (eigene Profile-Dir)
- Editor-Phase: linker Pane wechselt zu `nvim`/`bat`-Display, „tippt" die 6 Feature-Zeilen
- Screen-Capture via `ffmpeg -f avfoundation` (macOS) → `-vf "fps=15,scale=1280:-1" → gif`
- Output: `apps/marketing/public/hero/demo.gif`

### D9 — Manifest-driven Feature-Picker *(Blocker)*

`samples/apps/use-all-bundled/feature-manifest.json` existiert bereits (41 Features,
generiert via `bun run gen:manifest`) und liefert pro Feature: `name`, `description`,
`requires`, `optionalRequires`, `configReads`, `extensionsUsed`, `configKeys`, `secrets`.

Für den Picker fehlen: **UI-Hints**. Erweiterung an `defineFeature`:

```ts
defineFeature("auth-email-password", (r) => { ... }, {
  manifestHints: {
    displayLabel: "Auth · Email + Password",
    category: "identity",
    recommended: true,
    configurableOptions: [
      { key: "passwordReset", label: "Password-Reset-Flow", default: true },
      { key: "emailVerification", label: "E-Mail-Verifikation", default: false },
      { key: "signup", label: "Self-Service-Signup (Magic-Link)", default: false },
      { key: "invite", label: "Tenant-Invite-Flow", default: true },
    ],
  },
});
```

`gen:manifest` schreibt das mit raus → `create-kumiko-app` konsumiert ausschließlich
das Manifest, **kein hand-gepflegter Katalog** im Scaffolder. Ergibt:

```
? Welche Features?
  ◉ tenant                 (Multi-Tenancy)
  ◉ user                   (User-Identity)
  ◉ sessions               (Session-Lifecycle)
  ◉ auth-email-password    (Auth · Email + Password)
  ◉ delivery               (Notification-Routing)
  ◯ billing-foundation     (Subscription-Billing)
  ◯ compliance-profiles    (DSGVO / Audit)
  ◯ files                  (File-Storage)

? Auth · Email + Password konfigurieren:
  ◉ Password-Reset-Flow
  ◯ E-Mail-Verifikation
  ◯ Self-Service-Signup (Magic-Link)
  ◉ Tenant-Invite-Flow
```

**Dep-Resolver:** wer `auth-email-password` ankreuzt, kriegt `user` + `tenant`
auto-mit (aus `requires`); wer `billing-foundation` ankreuzt, wird gefragt welcher
Provider (`stripe` / `mollie`) — über `optionalRequires`.

**Konsequenz:** wenn ein neues Bundled-Feature in den framework gemerged wird +
`manifestHints` setzt + `gen:manifest` läuft, ist es **automatisch im Picker**.
Kein Scaffolder-Touch. Zero Drift zwischen „was Kumiko kann" und „was der Picker zeigt".

### D10 — Demo-Framework: ein Pattern, N Demos *(Medium)*

`scripts/record-demo.ts` ist nicht nur Hero-One-Off — es ist ein **erweiterbares
Pattern**, damit jede Bundled-Feature-Doc-Seite ihren eigenen 15s-GIF haben kann:

```
scripts/demos/
  ├── 01-create-app.ts        ← Hero (Phase 3)
  ├── 02-add-billing.ts       ← Showcase Billing
  ├── 03-tenant-switch.ts     ← Multi-Tenant
  └── 04-dsgvo-export.ts      ← Compliance
```

Jedes Demo-File exportiert ein ordered Steps-Array:

```ts
export default demo({
  title: "create-app",
  steps: [
    step.cli({ type: "bun create kumiko-app demo", caption: { de: "Projekt anlegen", en: "Create project" }}),
    step.cli({ type: "cd demo && bun dev", caption: { de: "Starten", en: "Boot" }}),
    step.browser({ navigate: "http://localhost:3000/login" }),
    step.browser({ click: "[data-test=login]", caption: { de: "Anmelden", en: "Sign in" }}),
    step.editor({ file: "src/features/notes.ts", write: NOTES_FEATURE_CODE, caption: { de: "Feature hinzufügen", en: "Add a feature" }}),
    step.browser({ waitFor: "[data-test=nav-notes]", caption: { de: "CRUD-Screen erscheint", en: "CRUD screen appears" }}),
  ],
});
```

**Drift-Test in CI:** `bun scripts/record-demo.ts --dry-run` validiert für **alle**
Demos: Selektoren existieren, Routen rendern, Editor-Targets liegen am richtigen
Pfad. Wenn Framework-Refactor einen Selektor bricht, fällt der CI-Job, *bevor*
ein Release rausgeht und das GIF lügt.

**Nach jedem Release:** `bun scripts/record-demo.ts --all` → frische GIFs für
Hero + jede Showcase-Seite + jede Feature-Doc-Seite. Reproduzierbar = wartbar.

### D11 — Captions statt Voice *(Low)*

GIFs sind silent — Verständlichkeit kommt aus **Captions**, nicht aus Voice-Spuren.
Voice (TTS / manuell) skipt v1 weil:

- TTS klingt billig, voice-cloning fragil
- Manuell aufnehmen = Sync-Aufwand bei jedem Release
- i18n (de/en) verdoppelt Aufwand
- Mute-Autoplay (Marketing-Sites default) macht Voice nutzlos
- GIF unterstützt sowieso keinen Audio-Track (für MP4 ginge es, aber siehe oben)

**Captions sind im Demo-Step ko-definiert** (`caption: { de, en }`, s. D10). Recorder
schreibt zusätzlich zum GIF/MP4 eine `captions.json` (Timecodes + Texte). Marketing-
Site rendert die Captions **als HTML-Layer neben** dem Video, nicht als ffmpeg-burn-in:

- Selektier-/copy-bar
- Keyboard-navigable
- Screen-reader-kompatibel (a11y)
- i18n-Sprach-Switch ändert nur die HTML-Captions, GIF bleibt
- Mute-Autoplay-tauglich

Voice als Folge-Iteration: wenn doch gewünscht, **nur Hero-Demo**, manuell aufgenommen,
nicht für N Feature-Demos.

### D12 — `config`/`secrets`-Features als Picker-Opt-In *(Medium)*

`config` und `secrets` sind setup-impacting (Backend-Wahl: `env` / `db` / `hybrid`)
— sie gehen in den Picker, nicht in den Default-Stack. `manifestHints` erweitert
`configurableOptions` um non-boolean Typen:

```ts
defineFeature("config", ..., {
  manifestHints: {
    displayLabel: "Config · Per-Tenant Key-Value",
    category: "operational",
    recommended: false,
    configurableOptions: [
      { key: "backend", type: "select",
        choices: [
          { value: "env", label: "Env-only (read .env)" },
          { value: "db", label: "DB (admin-editable, encrypted)" },
          { value: "hybrid", label: "Env-fallback + DB-override" },
        ],
        default: "env",
        setupImpact: "scaffolds .env vs migration+seed vs both" },
    ],
  },
});
```

`setupImpact` ist nur Hint-Text — der Picker zeigt vor Ausführung **was passieren
wird** („→ Wird `db/migrations/0001_config.sql` anlegen"). Transparenz statt Magie.

`secrets` parallel — gleiches Pattern, `backend: env | masterKey`.

### D13 — Scope-Hierarchie als Manifest-Detail, NICHT als Picker-Frage *(High)*

`config` + `tenant` + `user` zusammen erlauben Werte in vier Scopes: `env`,
`system`, `tenant`, `user`. Naive Lösung: Picker fragt pro Key wo der hingehört.
**Falsche Ebene** — initial wird kein User-/Tenant-Key gesetzt; Seeding macht das
auch nicht. Scope-Switching ist Runtime (Admin-UI / API), nicht Setup.

Was der Scaffolder wirklich braucht:
1. Wo legen wir den **Default-Wert beim Setup** ab? → fast immer `.env` (oder auto-generiert).
2. Welche Scopes sind beim **Runtime-Setzen** verfügbar? → ergibt sich aus den
   gewählten Features (`tenant` gewählt → tenant-scope da; `user` immer da).

Lösung: `manifestHints.configKeys` als deklaratives Inventar pro Feature:

```ts
defineFeature("auth-email-password", ..., {
  manifestHints: {
    configKeys: [
      { key: "JWT_SECRET",
        seedDefault: "auto-generate",         // Scaffolder generiert random in .env
        scopes: ["env"],                      // niemals tenant — security
        sensitive: true },
      { key: "PASSWORD_MIN_LENGTH",
        seedDefault: 8,
        scopes: ["env", "system", "tenant"],  // Tenant kann später überschreiben
        sensitive: false },
    ],
  },
});

defineFeature("mail-transport-smtp", ..., {
  manifestHints: {
    configKeys: [
      { key: "SMTP_HOST",
        seedDefault: "ask",                   // Picker fragt — einzige interaktive Stelle
        scopes: ["env", "system", "tenant"],
        sensitive: false },
    ],
  },
});
```

**Scaffolder-Algorithmus:**
1. Sammelt `configKeys` aus **allen gemounteten Features**.
2. `seedDefault: "auto-generate"` → random in `.env` (JWT-Secret, Cookie-Secret etc.).
3. `seedDefault: <literal>` → Literal in `.env`.
4. `seedDefault: "ask"` → **eine** Picker-Frage pro Key am Ende (idealerweise 0-3 Keys).
5. README listet alle runtime-overridable Keys mit Scope-Optionen:
   > `SMTP_HOST` — gesetzt in `.env`, kann pro Tenant via Admin-UI überschrieben werden,
   > sobald `config` + `tenant` gemountet sind.
6. `config`-Backend wählt Plugin-Stack basierend auf gewählten Features (`tenant`+`user`
   gewählt → tenant- und user-scope-Plugins aktiv). Picker fragt das **nicht** —
   ergibt sich aus Feature-Auswahl.

**Konsequenz:** Setup-Länge unverändert. Scope-Hierarchie ist Manifest-deklarativ,
Scope-Auswahl Runtime. Neues Feature mit Config-Key braucht nur `manifestHints.configKeys`
zu setzen, ist automatisch im Setup-Pfad korrekt.

**Validator in `gen:manifest`:** `scopes: ["tenant"]` ohne `tenant` in `requires` →
Manifest-Generation failed (Tenant-Scope ohne Tenant-Feature ist Unsinn).

### D14 — Quickstart-One-Liner (`curl | bash`) *(Medium)*

Industrie-Standard (rustup, deno, bun, homebrew, oh-my-zsh): ein einziger Befehl,
ohne Voraussetzungen, der den ganzen Setup-Pfad startet.

```bash
$ curl -fsSL https://kumiko.rocks/install.sh | bash
```

Das Skript:
1. Prüft ob `bun` installiert ist → wenn nicht: `curl -fsSL https://bun.sh/install | bash` (Bun's offizieller Installer)
2. `bun create kumiko-app <name>` — Name interaktiv (oder als zweites Arg: `curl ... | bash -s -- my-app`)
3. `cd <name>` + `bun install`
4. Zeigt Welcome-Banner (s. D4) mit „Nächster Schritt: `bun dev`" — startet **nicht** automatisch (User soll Kontrolle behalten)

**Hosting:** lebt als `apps/marketing/public/install.sh` → serviert unter
`https://kumiko.rocks/install.sh`. Mit der Marketing-Site mit-deployed, kein
eigener Service, kein Cloudflare-Worker — Astro static asset.

**Sicherheit:**
- HTTPS pflicht (Cloudflare-Redirect HTTP→HTTPS ist eh da)
- POSIX-bash, keine `rm -rf`, idempotent (nicht installiert → installieren; installiert → skippen)
- Klarer Output vor jedem Schritt („→ Installing bun…", „→ Scaffolding my-app…")
- Skript-Header zeigt Version + Build-Date, damit User nachvollziehen kann was er pipe'd

**Plattformen:** macOS + Linux (folgt Bun's Support-Matrix). Windows-User: Hinweis
auf WSL, kein eigener `install.ps1` für v1.

**Demo-Wert:** Hero zeigt jetzt:
```
$ curl -fsSL kumiko.rocks/install.sh | bash
   ↓ 30s
$ cd demo && bun dev
   → http://localhost:3000
```

→ Programmierer-Recognition („wie rustup, ich kenn das Muster"), kein
„erst-bun-installieren"-Friktion, eine Zeile statt drei.

## Phasen

| Phase | Scope | Aufwand |
|---|---|---|
| **Phase 1a — Manifest-Hints im framework** | `defineFeature(..., { manifestHints })` Schema (`displayLabel`/`category`/`recommended`/`configurableOptions`/**`configKeys` mit `seedDefault`+`scopes`+`sensitive`**); `configurableOptions` mit `select`/`string`/`boolean`-Typen; `gen:manifest` schreibt das raus + validiert (`scopes:["tenant"]` ohne `tenant`-`requires` = fail); alle 41 Bundled-Features annotiert, `config`/`secrets` mit Backend-Choice | ~1.5 d |
| **Phase 1b — Minimal-Scaffolder + Picker** | `packages/create-kumiko-app/` Paket; Inquirer-Picker konsumiert Manifest; Config-Key-Routing (`auto-generate`/`<literal>`/`ask`); README-Generator listet runtime-overridable Keys mit Scope-Optionen; `setupImpact`-Preview vor Ausführung; Template-Copy + Variable-Replace + auto-`bun install`; `welcomeBanner`-Option in `runDevApp` | ~2 d |
| **Phase 2 — `bun --hot` validieren + DB-Auto-Migration** | `bun --hot bin/main.ts` als dev-Script; Feature-Add → Reboot → DB-Migration durchläuft ohne manuelle Intervention; Smoke-Test | ~1 d |
| **Phase 2b — Quickstart-Installer** | `apps/marketing/public/install.sh` (POSIX-bash, Bun-Vorinstall-Detect + Auto-Install via `bun.sh/install`, dann `bun create kumiko-app`); deployed mit Marketing-Site auf `kumiko.rocks/install.sh`; Smoke-Test in fresh Linux+macOS-VM | ~0.5 d |
| **Phase 3 — Demo-Framework + Hero-Recording** | `scripts/demos/`-Pattern (D10) + `scripts/record-demo.ts`; `01-create-app.ts` zeigt **`curl ... \| bash`** (s. D14), nicht `bun create`; tmux + Playwright + ffmpeg-zu-GIF; Captions-HTML-Layer auf Marketing-Site; Hero-Update (`apps/marketing/src/pages/index.astro` + de) | ~1.5 d |
| **Phase 4 — Docs + Publish** | `docs/quickstart` neu (3 Befehle); CI-Job: Scaffold + `bun test` + Demo-`--dry-run` muss grün sein; `create-kumiko-app` in Lockstep-Release | ~0.5 d |
| **Phase 5 — Per-Feature-Demos (incremental)** | `scripts/demos/02-add-billing.ts`, `03-tenant-switch.ts`, `04-dsgvo-export.ts`; pro Feature-Doc-Seite Embed; entstehen sukzessive, nicht als Big-Bang | ~0.5 d/Demo |

**Gesamt: ~7 Tage** (+ ~0.5 d je weiterer Demo).

## Tests

- **Scaffolder-Smoke** (CI): in temp-dir `bunx create-kumiko-app demo && cd demo && bun install && bun test`. Muss grün sein — Scaffolder darf nicht broken-by-default ausliefern.
- **Picker-Snapshot** (CI): `create-kumiko-app --print-manifest` rendert alle aktuellen Picker-Choices als JSON; Snapshot-Test fängt unbeabsichtigte Manifest-Drifts.
- **Picker-Dep-Resolver** (CI): user wählt `auth-email-password`, Resolver muss `user` + `tenant` auto-mit-checken; user wählt `billing-foundation` ohne Provider, Resolver muss fragen.
- **Boot-Smoke**: nach `bun dev` HTTP-200 auf `/`; `/login` rendert; Admin-Seed existiert in DB.
- **Add-Feature-Smoke**: programmatisch `src/features/notes.ts` schreiben + `bin/main.ts` patchen + Reload abwarten + `POST /api/query notes:list` → 200.
- **Demo-Reproducibility** (CI): `bun scripts/record-demo.ts --dry-run --all` validiert für jedes Demo-Script: Selektoren existieren, Routen rendern, Editor-Targets liegen am richtigen Pfad. Bricht, *bevor* ein Release lügt.

## Risiken

1. **`bun --hot` reicht nicht** — Re-Boot zu langsam (>3s), DB-Migration verklemmt oder Hot-Loop produziert Connection-Leaks. Phase 2 Validator. Fallback: D6-Option-C (Spinner kaschieren).
2. **Template-Versions-Drift**: bei Framework-Minor-Bump müssen Template-pinned Versionen mit. Lockstep via Changeset-Pin (wie `kumiko-cli`, siehe `feedback_publish_pin_drift_guard_lockstep_assumption.md`).
3. **macOS-only Recording-Pipeline**: GIF-Capture auf Marc's Mac, nicht in CI. Manuelle Re-Capture bei Framework-API-Drift nötig. Mitigation: `scripts/record-demo.ts` reproduzierbar genug, dass 1 Befehl reicht.
4. **`create-kumiko-app`-Namespace auf npm möglicherweise belegt** — vor Phase 1 prüfen. Fallback: `create-kumiko`.
5. **Demo-Wow hängt am Add-Feature-Reload** — wenn der Renderer Sidebar-Items nicht auto-discovers oder der CRUD-Screen Manual-Wiring braucht, fällt der Wow weg. Vor Phase 2 quick-Spike (1h) gegen aktuellen renderer-web.

## DoD

- [ ] `npm view create-kumiko-app` zeigt ein veröffentlichtes Paket
- [ ] `curl -fsSL kumiko.rocks/install.sh | bash` läuft auf frischem macOS und Linux ohne Voraussetzungen; installiert bun bei Bedarf und scaffoldet das Projekt
- [ ] `defineFeature(..., { manifestHints })` Schema im framework; alle 41 Bundled-Features tragen `displayLabel`/`category`/`recommended`/`configurableOptions`/`configKeys` (mit `seedDefault`+`scopes`+`sensitive`)
- [ ] `gen:manifest`-Validator: `scopes:["tenant"]` ohne `tenant`-`requires` failed
- [ ] Scaffolder routet Config-Keys (`auto-generate`/`<literal>`/`ask`) automatisch; runtime-overridable Keys im generierten README mit Scope-Optionen dokumentiert
- [ ] `bun create kumiko-app demo` → Picker rendert aus Manifest, Dep-Resolver auto-checkt `requires`, frischer Output `bun dev` läuft, Browser zeigt Login
- [ ] Add-Feature-Skript: 6-Zeilen-Edit → CRUD-Screen erscheint ohne manuelles Restart
- [ ] Marketing-Hero (de + en) zeigt 60s-Split-Screen-GIF (CLI ↔ Browser), demo-real, kein faked screenshot
- [ ] Captions als HTML-Layer **neben** dem GIF, i18n-Switch ändert nur Captions
- [ ] `scripts/demos/`-Pattern etabliert, mind. das Hero-Demo + 1 weiteres lauffähig
- [ ] `--dry-run --all` in CI grün
- [ ] `docs/quickstart` neu, 3-Befehl-Story, Link in Hero
- [ ] `bun kumiko check` PASS
- [ ] Frontmatter: `status: shipped`, `evidence: PR#…`

## Verhältnis zu anderen Plänen

- **`auth-foundation-migration.md`** (#561): Scaffold-Template nutzt `composeFeatures(authFoundation(), sessions(), …)` sobald Phase 2 dort gemerged. Bis dahin: alte `runProdApp.auth.sessions`-Wiring + TODO-Kommentar im Template.
- **`personal-access-tokens.md`** (PAT): nach PAT-Phase-2 als optional-Feature im Template, hinter Kommentar.
- **Showcase-Hero-Umformulierung** (separate Mini-PR): unabhängig — kann sofort iteriert werden, ergänzt aber nicht ersetzt den Scaffold-Hero.

## Review-Log

- **2026-06-21** Initial. Aus 2026-06-21-Diskussion „Pitch-Verständnis-Problem" abgeleitet
  (Marc-Feedback: „jeder den ich kumiko zeig sagt er versteht nicht was es macht").
  Lösungs-Variante B aus dem 3-Experimente-Vorschlag (Demo-GIF im Hero) — gesetzte
  Voraussetzung war ein realer `bun create kumiko-app`-Flow, der heute nicht
  existiert. Plan bündelt Scaffolder + Demo-Recording in einem Issue, weil das
  „First-Run-Script" gleichzeitig Produkt-Feature (echte User) und Marketing-Asset
  (GIF) ist. Trennung würde Drift erzeugen.

- **2026-06-21** Update 3 (Marc-Anfrage). D14 — `curl -fsSL kumiko.rocks/install.sh | bash`
  als Quickstart-One-Liner. Industriestandard-Muster (rustup/deno/bun/homebrew/
  oh-my-zsh), Programmierer-Recognition sofort da. Skript lebt als static asset
  auf der Marketing-Site (`apps/marketing/public/install.sh`), kein eigener
  Service. Installiert Bun bei Bedarf via `bun.sh/install`, dann `bun create
  kumiko-app`. Phase 2b neu (~0.5 d). Demo-Hero (Phase 3) zeigt jetzt diesen
  One-Liner statt `bun create` — kein „erst-bun-installieren"-Friktion im GIF.
  Gesamt jetzt ~7 d.

- **2026-06-21** Update 2 (Marc-Anfrage). `config`/`secrets` als Picker-Opt-In
  einplanen + Scope-Hierarchie-Problem sauber lösen:
  - **D12 — `config`/`secrets`-Backend-Wahl**: `configurableOptions` erweitert
    um `select`/`string`-Typen + `setupImpact`-Preview im Picker. Härtet das
    Picker-Pattern für künftige setup-impacting Features (`mail-transport-smtp`,
    `subscription-stripe` etc.) — keine rückwirkende Schema-Migration nötig.
  - **D13 — Scope-Hierarchie als Manifest-Detail**: `configKeys` deklariert
    `seedDefault` (`auto-generate`/`<literal>`/`ask`) + `scopes` (welche
    Scopes runtime erlaubt sind) + `sensitive`. Setup-Länge unverändert —
    initial werden keine user/tenant-Keys gesetzt; Scope-Switching ist
    Runtime (Admin-UI/API). Scaffolder routet automatisch + README-Generator
    listet runtime-overridable Keys mit Scope-Optionen.
  Phase 1a +0.5 d, Phase 1b +0.5 d. Gesamt jetzt ~6.5 d.

- **2026-06-21** Update 1 (Marc-Anfrage). D3-Non-Ziel „kein Picker" geflippt. Drei
  neue Design-Entscheidungen:
  - **D9 — Manifest-driven Picker**: `feature-manifest.json` (existiert,
    41 Features) wird via `defineFeature.manifestHints` um UI-Hints erweitert.
    Scaffolder hat **keinen** hand-gepflegten Feature-Katalog — neue Bundled-
    Features sind automatisch im Picker, sobald sie `manifestHints` setzen und
    `gen:manifest` läuft. Zero Drift.
  - **D10 — Demo-Framework**: `scripts/demos/`-Pattern + ordered-Steps-DSL,
    damit jede Bundled-Feature-Doc-Seite ihren eigenen 15s-GIF haben kann.
    `--dry-run --all` in CI fängt Selector-Drift bei Framework-Refactors.
  - **D11 — Captions statt Voice**: silent GIF/MP4 + HTML-Caption-Layer
    neben dem Video (selektierbar, a11y, i18n-Switch). Voice skipt v1
    (TTS billig, i18n verdoppelt Aufwand, Mute-Autoplay killt Mehrwert).
  Neue Phase 5 (Per-Feature-Demos, incremental). Phase 1 split in 1a
  (Manifest-Hints im framework) + 1b (Scaffolder). Gesamt: ~5.5 d statt ~4 d.
