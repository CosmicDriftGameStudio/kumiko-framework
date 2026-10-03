---
"@cosmicdrift/kumiko-renderer-web": patch
---

`DefaultAppShell` and `WorkspaceShell` render exactly one `main` landmark. `SidebarInset` is now a `div`, so the shell's own `main` around the screen content is the only one, and the `ShellHeader` sits outside it. Screen readers no longer announce two main regions, and `getByRole("main")` in E2E tests matches a single element.

<!-- kumiko-changes
feature: renderer-web
type: fix
title: App shells render a single main landmark
-->
