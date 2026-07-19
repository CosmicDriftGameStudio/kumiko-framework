---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

Fix `KumikoScreen` rendering role-gated screens for users without a matching role (#1203). `access.roles` was only enforced for nav/workspace visibility (`filterByAccess` in `workspace-shell.tsx`) — the actual screen-render path had no independent check, so any authenticated user reaching a role-gated screen via a direct URL, bookmark, or the app's `screenQn` fallback saw the screen's chrome regardless of role. Data stayed safe (query/write handlers are still server-side role-checked), this was a chrome leak, not a data leak.

`KumikoScreen` now gates on `screen.access` using the same roles the shells already pass for nav filtering, threaded down via a new `UserRolesProvider`/`useUserRoles` (exported from `@cosmicdrift/kumiko-renderer`). `WorkspaceShell` and `DefaultAppShell` wrap their children with it using `user?.roles`. Consistent with `filterByAccess`'s existing default-deny: no provider mounted, or `roles` not passed, denies role-gated screens — apps with role-gated screens must wire `user` into their shell (the same prop they already pass for nav) or those screens render an "access denied" placeholder instead of their content.
