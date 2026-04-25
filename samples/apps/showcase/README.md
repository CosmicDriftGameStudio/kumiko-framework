# Showcase

Kitchen-Sink-Demo der Kumiko-Renderer-Surface — alle Field-Types die
DefaultInput rendert, alle relevanten Layout-Pfade, alle Primitive-
States durch normale Click-Pfade erreichbar. Gut zum schnellen
optischen + funktionellen Sichten beim Refactoring.

**Kein Auth** — der Server läuft im Auto-Mint-JWT-Mode, du landest
direkt im Edit-Screen ohne Login. Wer Auth-Pfade testen will, schaut
in `samples/apps/ui-walkthrough` oder `samples/apps/workspaces`.

## Run

```bash
yarn kumiko dev                  # Postgres + Redis
cd samples/apps/showcase && yarn dev
# → http://localhost:4175
```

Port 4175 ist hardcoded damit drei Sample-Apps parallel laufen können
(ui-walkthrough=4173, workspaces=4174).

## Click-Through-Guide

### Empty-State (List-Primitive)

Nach Mount → List-Screen mit "No entries." (`render-list-empty`).
Sidebar zeigt zwei Nav-Einträge ("Items", "Neuer Eintrag"), Topbar hat
Brand + ThemeToggle.

### Form-Primitives + Conditional Visibility

Klick auf "Neuer Eintrag" → entityEdit-Screen.

- **Section "Basics"** mit 2-Spalten-Layout (`Section` mit `columns: 2`),
  Mobile (<640px) automatisch einspaltig
- **`title`** als `text` Input, full-width via `span: 2` (Required-Marker
  rot rechts neben dem Label)
- **`priority`** als `number` Input, Default 1
- **`isDone`** als checkbox
- **`status`** als shadcn/Radix-Select-Dropdown mit 4 Optionen
  (draft/active/blocked/done), Default "draft", full-width
- **Section "Details"** mit 1-Spalte-Layout
- **`notes`** ist UNSICHTBAR — `visible: (d) => d.isDone === true`,
  rendert als 4-zeilige Textarea wenn sichtbar (`multiline: { rows: 4 }`)
- **`dueDate`** als nativer date-Picker

→ Tick **`isDone`**: das `notes`-Textarea erscheint mit Required-Marker.
Beweist die FieldCondition-Pipeline.

→ Wechsle den Status im Dropdown: Form-Controller markiert dirty,
Submit-Button enabled.

### Validation + Submit-Button-States

- Submit-Button ist **disabled** solange das Form unverändert ist
  (`isUnchanged` Gate) — sieht sofort grau aus
- Tippe in `title` → Button enabled sich
- Tick isDone, lass title leer, submit → `field-error` an title
- Submit mit valid: navigiert zur Liste

### List-Primitive mit Daten + Custom-Renderer

Nach erstem Submit → List-Screen.

- **DataTable** mit Spalten Title, Status, IsDone (rendert ✓ / ✗),
  Priority (Custom-Renderer `(v) => v === 0 ? "—" : "P{v}"`), DueDate

→ Klick auf die Row → navigiert zur Edit-Form für genau dieses Item
(useDispatcher.detail-Query).

### Optimistic Locking + Version Conflict

- Zwei Browser-Tabs: beide auf den Edit-Screen für dasselbe Item
- Tab A: Title ändern, Submit → Erfolg, navigiert zurück
- Tab B: Title ändern, Submit → **`version_conflict`**-Banner mit
  "Neu laden"-Button. Klick → Form rebased auf den neuen Server-State.

### Theme-Toggle

Click auf den Theme-Toggle (Sonne/Mond rechts oben) → `<html class>`
wechselt zwischen `light` und `dark`. Tailwind-Tokens (background,
foreground, border, accent) passen sich an.

### Responsiveness

- Browser-Window auf <640px Breite ziehen → 2-Spalten-Section wird
  einspaltig (Mobile-Breakpoint sm:)
- Form bleibt zentriert mit `max-w-3xl` (768px) — auf großen Screens
  spreizen sich Inputs nicht über die volle Breite

## Was beweisbar ist

- Form-Controller: dirty/changes/errors-Tracking
- Validation: required + conditional required
- Optimistic Locking: version-Stempel, Conflict-Banner, Reload-Pfad
- Field-Conditions: visible + required als Functions auf `data`
- DataTable: Empty-State, Header-Row, Cell-Renderers (boolean ✓/✗,
  custom render-function)
- Layout: Section-Title, responsive columns + span, KumikoLink, NavTree
- Theme: light/dark via TokensProvider
- AppSchema-Injection: kein hand-geschriebener clientSchema, alles
  vom Server geliefert

## Was hier NICHT drin ist

- `timestamp`-Field-Type (Tier 2.2 pending)
- `money`-Field-Type (Tier 2.3 pending)
- Searchable Select (Tier 2.1c pending)
- Multi-Select (Tier 2.1d pending)
- `embedded`-Field-Type (Tier 2.4 pending — niedrige Prio)
- `file/image`-Field-Types (Tier 2.5/2.5b pending — Resize-Pipeline + UI)
- Auth-Pfade (siehe `samples/apps/ui-walkthrough/`)
- Workspaces (siehe `samples/apps/workspaces/`)
- TenantSwitcher mit mehreren Tenants (siehe `samples/apps/ui-walkthrough/`)
- LanguageSwitcher (siehe `samples/apps/ui-walkthrough/`)

Wenn ein Primitive dazukommt, gehört es hier rein.
