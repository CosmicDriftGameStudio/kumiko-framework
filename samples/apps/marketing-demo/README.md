# Marketing-Demo

Sample-App, die Marketing-Screenshots für [kumiko.so](https://kumiko.so)
liefert. Zwei kleine Internal-Tools (Asset-Tracker + Helpdesk) auf
einer Kumiko-Instanz — DACH-Persona-Beweis dass derselbe Framework-Stack
zwei Tools deckt, ohne separate Codebases.

**Kein Auth** — wie der Showcase im Auto-Mint-JWT-Mode. Direkt im
Edit/List-Screen ohne Login. Wer Auth-Pfade testen will, schaut in
`samples/apps/ui-walkthrough/`.

## Run

```bash
yarn kumiko dev                          # Postgres + Redis
cd samples/apps/marketing-demo && yarn dev
# → http://localhost:4178
```

Port 4178 ist hardcoded damit die Sample-Apps parallel laufen können
(showcase=4175, ui-walkthrough=4173, workspaces=4174,
publicstatus=4176/77).

## Was drin ist

### Asset-Tracker (12 Felder)

- `name`, `type` (laptop/monitor/phone/tool/license/other), `status`
  (available/lent/maintenance/broken), `department`, `owner`,
  `location`, `serialNumber`, `vendor`, `price`, `purchaseDate`,
  `warrantyUntil`, `notes` (multiline)
- Edit-Form: 3 Sections (Stammdaten / Zuordnung / Einkauf)
- List: 9-Spalten DataTable mit translated Status-Cells
- ~70 Items im Seed (35 Templates × 1-3 Kopien, deterministisch)

### Helpdesk (10 Felder)

- `title`, `description` (multiline), `category` (hardware/software/
  account/network/license/other), `severity`, `status` (open/
  investigating/resolved/closed), `department`, `reporter`, `assignee`,
  `dueDate`, `spentMinutes`
- Edit-Form: 3 Sections (Ticket / Personen / Tracking)
- List mit Severity-Default-Sort
- 35 Tickets mit deutschen Titeln

## i18n

Alle Field-Labels + Select-Options haben DE+EN-Translations
(`<feature>:entity:<entity>:field:<field>`,
`<feature>:entity:<entity>:field:<field>:option:<value>`). Listen-Cells
und Form-Selects greifen die Translation aus dem ViewModel-Builder —
so rendern `hr` → "HR" / "Personal", `lent` → "Lent out" / "Ausgeliehen"
statt raw values.

## Schema-Pattern

Beide Schemas nutzen `createEntity()` + Field-Factories
(`createTextField`, `createSelectField`, `createDateField`,
`createNumberField`) statt Inline-Object-Cast. Die Select-Options sind
als `as const`-Konstanten exportiert (`ASSET_STATUSES`, `TICKET_SEVERITIES`,
…) — der Seed leitet seine Template-Types daraus ab, kein Drift wenn
Options sich ändern.

## Screenshots

```bash
yarn screenshots                         # Playwright E2E auf 4179
```

Schreibt 4 PNGs nach
`../../../kumiko-platform/apps/marketing/public/screenshots/`:

- `asset-list.png` — DataTable mit translated Cells
- `asset-edit.png` — 3-Section Edit-Form
- `ticket-list.png` — Helpdesk mit Severity-Default-Sort
- `ticket-edit.png` — Ticket-Form

Override via `SCREENSHOT_DIR`-Env wenn die Repos nicht beide unter
`/Users/marc/code/` liegen. Wird vom CI nicht automatisch ausgeführt —
manuelle Regeneration nach Schema- oder Branding-Änderungen.

Setup-Details in `e2e/screenshots.spec.ts` + `e2e/scenarios.ts`.

## Was hier NICHT drin ist

- Auth (siehe `apps/ui-walkthrough/`)
- Workspaces (siehe `apps/workspaces/`)
- Custom Workflows / Lifecycle-Hooks (siehe `recipes/`)
- Domain-spezifische Features — das ist explizit ein Marketing-Showcase,
  kein Business-Sample.
