# Workspaces

Demo of `WorkspaceShell` — the alternative to `DefaultAppShell` for
multi-persona apps. A user sees different "workspaces" depending on
their role (admin / dispatch / driver), each with its own sidebar nav.
The active workspace lives in the URL (`/<workspace>/<screen>`) so
bookmarks, reloads, and shared links land on the same surface.

Plus: cross-feature membership — a nav from the `demo-driver` feature
belongs to the `driver` workspace owned by the `demo` feature. The
server registry resolves the merge, the browser receives the assembled
AppSchema via `window.__KUMIKO_SCHEMA__` injection.

## Run

```bash
# Boot Postgres + Redis (once)
bun kumiko dev

# In a new terminal — boots the sample on http://localhost:4174
cd samples/apps/workspaces && bun dev
```

Port 4174 is hardcoded so three sample apps can run in parallel
(ui-walkthrough=4173, showcase=4175).

## Login

```
admin@kumiko.dev
kumiko-admin
```

The admin has the `Admin` role and sees all three workspaces.
Specialized personas (Dispatcher, Driver) would only see their own —
see `feature.ts` for the workspaces' `access.roles` configuration.

## What to try

**Workspace switch**
- Three tabs in the topbar: System Admin / Cockpit / Driver.
- Clicking switches → URL is rewritten to `/dispatch/order-list`,
  sidebar navs filter to the members of the active workspace.

**Cross-feature nav**
- Click the "Driver" workspace → you see "New Order" (from `demo`) +
  "My Tour" (from `demo-driver`). Both features each register a nav,
  and the engine merges them into the Driver workspace.

**Default resolution**
- URL without a workspace segment → lands on `admin` (default-flagged).
- URL with an unknown workspace → falls back to default.
- URL with `/admin` (no screen) → auto-fills the first nav member.

**URL = source of truth**
- Reload mid-`dispatch`-workspace → stays there.
- Browser back after a workspace switch → returns to the previous
  workspace (replaceState is used for initial fills, pushState for
  user clicks).

## Tests

```bash
# Unit (registry compose)
bun test

# Playwright E2E
bun kumiko test e2e samples/apps/workspaces
```
