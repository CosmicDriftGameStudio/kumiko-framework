# Workspaces

Demo der `WorkspaceShell` — der Alternative zu `DefaultAppShell` für
Multi-Persona-Apps. Ein User kann je nach Rolle verschiedene
„Workspaces" sehen (admin / dispatch / driver), jeder mit eigener
Sidebar-Nav. Active Workspace lebt in der URL (`/<workspace>/<screen>`)
damit Bookmarks + Reload + Shared-Links auf der gleichen Surface landen.

Plus: Cross-Feature-Membership — eine Nav aus dem `demo-driver`-Feature
gehört zum `driver`-Workspace des `demo`-Features. Server-Registry
löst die Merge auf, der Browser bekommt das fertige AppSchema via
`window.__KUMIKO_SCHEMA__`-Injection.

## Run

```bash
# Postgres + Redis hochfahren (einmal)
yarn kumiko dev

# In neuem Terminal — bootet Sample auf http://localhost:4174
cd samples/apps/workspaces && yarn dev
```

Port 4174 ist hardcoded damit drei Sample-Apps parallel laufen können
(ui-walkthrough=4173, showcase=4175).

## Login

```
admin@kumiko.dev
kumiko-admin
```

Der Admin hat Rolle `Admin` und sieht alle drei Workspaces.
Spezialisierte Personas (Dispatcher, Driver) würden nur ihren — siehe
`feature.ts` für die `access.roles`-Konfiguration der Workspaces.

## Was zu probieren

**Workspace-Switch**
- Drei Tabs in der Topbar: System-Admin / Cockpit / Fahrer.
- Klick wechselt → URL wird zu `/dispatch/order-list` rewritten,
  Sidebar-Navs filtern sich auf die Members des aktiven Workspaces.

**Cross-Feature-Nav**
- Klick auf "Fahrer"-Workspace → siehst "Neuer Auftrag" (aus `demo`) +
  "Meine Tour" (aus `demo-driver`). Beide Features registrieren je eine
  Nav, die Engine merge'd sie ins Driver-Workspace.

**Default-Resolution**
- URL ohne Workspace-Segment → landet auf `admin` (default-flagged).
- URL mit unbekanntem Workspace → fallback auf default.
- URL mit `/admin` (ohne Screen) → auto-fillt erstes Nav-Member.

**URL = Source of Truth**
- Reload mitten im `dispatch`-Workspace → bleibt dort.
- Browser-Back nach Workspace-Switch → vorheriger Workspace zurück
  (replaceState wird für initial-fills genutzt, pushState für User-Klicks).

## Tests

```bash
# Unit (Registry-Compose)
yarn vitest run samples/apps/workspaces/src/__tests__/feature.test.ts

# Playwright-E2E
yarn kumiko test e2e samples/apps/workspaces
```
