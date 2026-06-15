---
"@cosmicdrift/kumiko-framework": minor
---

Settings-Hub: place the audience nav-groups inline in app workspaces

The self-populating Settings-Hub previously always surfaced as its own
`settings` workspace (a separate top-bar switcher entry) in workspace-mode apps.
An app can now place the hub **inline** in its own workspaces instead: reference
a generated audience parent — `config:nav:audience-system` / `…-tenant` /
`…-user` — in an `r.workspace({ nav: [...] })` list, and `buildAppSchema`
expands that audience's child screen-navs into the same workspace (so the nav
slice keeps them) and drops the audience from the standalone switcher.

- **Per-persona placement:** put `config:nav:audience-system` in a SystemAdmin
  workspace and `config:nav:audience-tenant` in a tenant-admin workspace, and the
  platform-default vs. tenant-override screens land in the right sidebars with no
  extra "Einstellungen" tab.
- **Nothing vanishes:** an audience no workspace places stays reachable in the
  standalone settings workspace (a dev-only warning names it so the author can
  place it). Place every audience → the standalone tab disappears. Place none →
  behaviour is unchanged (the whole settings workspace is appended as before).
- **Boot guard:** `validateWorkspaces` exempts exactly the three generated
  `config:nav:audience-<scope>` QNs (synthesised after boot, never `r.nav()`-
  registered); every other unregistered nav ref still throws, and a typo'd
  audience QN is dropped by the render-time slice filter.
