---
"@cosmicdrift/kumiko-renderer-web": minor
---

`WorkspaceShell` now renders on the same modern shell as `DefaultAppShell`: a collapsible icon-rail sidebar (brand + workspace switcher + nav + footer) and a `SidebarInset` with a shared `ShellHeader` (panel toggle + active-screen breadcrumb + right-aligned actions). The separate topbar is gone — `topbarActions` now render in the header's right slot, the brand moves into the sidebar. Props are unchanged, so existing `WorkspaceShell` apps pick up the header, breadcrumb and rail automatically. `ShellHeader` is extracted so both shells share one header definition.
