# Showcase

Kitchen-Sink-Demo der Kumiko-Renderer-Surface — alle Field-Types die
DefaultInput rendert, alle relevanten Layout-Pfade, alle Primitive-
States durch normale Click-Pfade erreichbar. Gut zum schnellen
optischen + funktionellen Sichten beim Refactoring.

## Run

```bash
yarn kumiko dev                  # Postgres + Redis
cd samples/apps/showcase && yarn dev
# → http://localhost:4173
```

## Login

```
admin@kumiko.dev
kumiko-admin
```

## Click-Through-Guide

### Empty-State (List-Primitive)

Direkt nach Login → leere List-Screen. Du solltest sehen:

- Sidebar: zwei Nav-Einträge ("Items", "Neuer Eintrag") — `NavTree`
- Topbar: Brand links, TenantSwitcher (versteckt bei nur einem
  Tenant), ThemeToggle, UserMenu rechts — `DefaultTopbarActions`
- Main: gerahmtes "No entries." — `render-list-empty`

### Form-Primitives + Conditional Visibility

Klick auf "Neuer Eintrag" → entityEdit-Screen.

- **Section "Basics"** mit 2-Spalten-Layout (`Section` mit `columns: 2`)
- **`title`** als `text` Input, full-width via `span: 2` (Required-Marker
  rot rechts neben dem Label)
- **`priority`** als `number` Input, Default 1 (sieht "1" sofort im
  Feld)
- **`isDone`** als checkbox
- **Section "Details"** mit 1-Spalte-Layout
- **`notes`** ist UNSICHTBAR — `visible: (d) => d.isDone === true`
- **`dueDate`** als nativer date-Picker

→ Tick **`isDone`**: das `notes`-Feld erscheint mit Required-Marker.
Beweist die FieldCondition-Pipeline.

### Validation + Submit-Button-States

- Submit-Button ist **disabled** solange das Form unverändert ist
  (`isUnchanged` Gate) — sieht sofort grau aus
- Tippe in `title` → Button enabled sich
- Klick auf Submit ohne `title` einzutippen: nicht möglich, dann
  füll `title` und lösch ihn wieder → bleibt enabled bis... hmm
  besser: tick isDone, dann title=leer + submit → `field-error` an title
- Submit mit valid: Submit klappt, navigiert zur Liste

### List-Primitive mit Daten + Custom-Renderer

Nach erstem Submit → List-Screen (KumikoScreen useNavigateToListAfter).

- **DataTable** mit Spalten Title, IsDone (rendert ✓ / ✗), Priority
  (Custom-Renderer `(v) => v === 0 ? "—" : "P{v}"`), DueDate
- Einzeilige Tabelle für deinen ersten Eintrag

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

### Tenant-Switcher

Bei diesem Sample nur ein Tenant (Demo Tenant) — der TenantSwitcher
versteckt sich. Wenn du mehrere demonstrieren willst, kopiere den
ui-walkthrough-Sample (zwei Tenants).

### UserMenu

Klick auf User-Avatar rechts oben → Dropdown mit Logout-Action.
`session.logout()` → Cookies clear → Page-Reload → wieder
LoginScreen.

## Was beweisbar ist

- Form-Controller: dirty/changes/errors-Tracking
- Validation: required + conditional required
- Optimistic Locking: version-Stempel, Conflict-Banner, Reload-Pfad
- Field-Conditions: visible + required als Functions auf `data`
- DataTable: Empty-State, Header-Row, Cell-Renderers (boolean ✓/✗,
  custom render-function)
- Layout: Section-Title, columns, span, KumikoLink, NavTree
- Theme: light/dark via TokensProvider
- Auth: Login → AuthGate → Session → useShellUser
- AppSchema-Injection: kein hand-geschriebener clientSchema, alles
  vom Server geliefert

## Was hier NICHT drin ist

- `select`-Field-Type (DefaultInput hat noch keinen select-case)
- `money`-Field-Type
- `embedded`-Field-Type
- `file/image`-Field-Types (S3-Setup nötig)
- `WorkspaceShell` mit role-gating (siehe `samples/apps/workspaces/`)
- TenantSwitcher mit mehreren Tenants (siehe `samples/apps/ui-walkthrough/`)
- LanguageSwitcher (siehe `samples/apps/ui-walkthrough/`)

Wenn ein Primitive dazukommt, gehört es hier rein.
