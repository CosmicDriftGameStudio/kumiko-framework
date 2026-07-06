---
"@cosmicdrift/kumiko-bundled-features": minor
---

admin-shell: neues bundled-feature für rollen-gated Tenant- und Platform-Workspaces mit Overview-Home-Screens, Nav-Icons und Server-i18n. Komponiert Screens aus `tenant`, `audit`, `jobs` und optional `tier-engine` — mount nach diesen Features. Overview-Queries laufen über eine fest kodierte Allowlist pro Workspace, um versehentliche Cross-Workspace-Datenzugriffe zu verhindern.
