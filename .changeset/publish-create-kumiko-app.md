---
"create-kumiko-app": patch
---

Release-script (`scripts/publish-with-oidc.sh`) allowlist now permits unscoped
`create-kumiko-app` (and the `create-kumiko` fallback per Plan-Doc D1).
Previously the case-statement allowed only `@cosmicdrift/*` workspaces, so
every release silently skipped the bun-create wrapper — `npm view
create-kumiko-app` 404'd and `https://kumiko.rocks/install.sh`
(Phase 2b) had nothing to install.
