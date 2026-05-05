# UI Walkthrough

Full-Stack-Demo des Kumiko-Renderers: `DefaultAppShell` + `LanguageSwitcher`
+ `ThemeToggle` + `emailPasswordClient` + `TenantSwitcher` + Tasks-CRUD.
Bootet via `runDevApp` aus `@cosmicdrift/kumiko-dev-server` mit Auth-Mode (Login-
Screen vor Zugang) und zwei Dev-Tenants damit der TenantSwitcher
sichtbar wird.

## Run

```bash
# Postgres + Redis hochfahren (einmal)
yarn kumiko dev

# In neuem Terminal — bootet Sample auf http://localhost:4173
cd samples/apps/ui-walkthrough && yarn dev
```

Port 4173 ist hardcoded im dev-Script damit drei Samples parallel laufen
können (workspaces=4174, showcase=4175). `KUMIKO_DEV_DB_NAME=tasks_demo
yarn dev` für persistente DB (Daten überleben Restart).

## Login

```
admin@kumiko.dev
kumiko-admin
```

Der Admin ist Mitglied in zwei Tenants — der TenantSwitcher in der
Topbar wechselt zwischen "Dev Tenant" (Rolle Admin) und "Beta Tenant"
(Rolle User), und beweist tenant-isolierte Memberships.

## Was zu probieren

**Form + Validation**
- Tippe in **Title** — der Form-Controller pinnt `dirty` + `changes`.
- Leerer Title + Submit → `required`-Validierung blockt, kein Netz-Call.
- Tick **Is urgent** → das `notes`-Feld erscheint mit Required-Marker.
- Mit urgent+leeren-notes submitten → Field-Error.

**Optimistic Locking**
- Open Form für eine Task in Tab A.
- Edit dieselbe Task in Tab B, save.
- Tab A: save → Banner "Version-Conflict, neu laden".

**Tenant-Switch**
- Klick auf Tenant-Switcher in der Topbar → wechselt zu Beta-Tenant.
- Aufgaben-Liste leer (Beta hat keine), Rolle wechselt zu User.

**Theme-Toggle**
- Klick auf Sonne/Mond rechts oben — `<html>`-class wechselt
  zwischen `light` und `dark`, Tailwind-Tokens passen sich an.

**Sprache**
- LanguageSwitcher → de/en, Nav-Labels switchen sofort
  (`tasks.nav.list` → "Aufgaben" / "Tasks").

## Tests

```bash
# Aus Repo-Root
yarn kumiko test e2e samples/apps/ui-walkthrough
```

Sechs Playwright-Specs: smoke + create-flow + update-flow + 4
generated-Specs (aus dem Registry-driven E2E-Generator).
