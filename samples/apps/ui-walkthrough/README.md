# UI Walkthrough

Full-stack demo of the Kumiko renderer: `DefaultAppShell` +
`LanguageSwitcher` + `ThemeToggle` + `emailPasswordClient` +
`TenantSwitcher` + tasks CRUD. Boots via `runDevApp` from
`@cosmicdrift/kumiko-dev-server` in auth mode (login screen before
access) with two dev tenants so the TenantSwitcher is visible.

## Run

```bash
# Boot Postgres + Redis (once)
yarn kumiko dev

# In a new terminal — boots the sample on http://localhost:4173
cd samples/apps/ui-walkthrough && yarn dev
```

Port 4173 is hardcoded in the dev script so three samples can run in
parallel (workspaces=4174, showcase=4175). Use
`KUMIKO_DEV_DB_NAME=tasks_demo yarn dev` for a persistent DB (data
survives restarts).

## Login

```
admin@kumiko.dev
kumiko-admin
```

The admin is a member of two tenants — the TenantSwitcher in the
topbar toggles between "Dev Tenant" (role Admin) and "Beta Tenant"
(role User), proving tenant-isolated memberships.

## What to try

**Form + validation**
- Type into **Title** — the form controller pins `dirty` + `changes`.
- Empty title + submit → `required` validation blocks, no network call.
- Tick **Is urgent** → the `notes` field appears with a required marker.
- Submit with urgent + empty notes → field error.

**Optimistic locking**
- Open the form for a task in tab A.
- Edit the same task in tab B, save.
- Tab A: save → banner "Version conflict, reload".

**Tenant switch**
- Click the tenant switcher in the topbar → switches to the Beta tenant.
- Task list is empty (Beta has none), role flips to User.

**Theme toggle**
- Click sun/moon top-right — `<html>` class toggles between `light`
  and `dark`, Tailwind tokens follow.

**Language**
- LanguageSwitcher → de/en, nav labels switch instantly
  (`tasks.nav.list` → "Aufgaben" / "Tasks").

## Tests

```bash
# From repo root
yarn kumiko test e2e samples/apps/ui-walkthrough
```

Six Playwright specs: smoke + create flow + update flow + 4 generated
specs (from the registry-driven E2E generator).
