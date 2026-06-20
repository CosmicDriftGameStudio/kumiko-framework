---
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

feat(auth): UserMenu sidebar variant — full NavUser footer row across all apps

The app shell's `sidebarFooter` slot wants the sidebar-07 NavUser row (avatar +
name + email + chevron), but the bundled `UserMenu` only rendered a compact topbar
pill, and `SidebarUser` is display-only (no logout/profile actions). Apps were stuck
choosing between the polished row OR the actions.

`UserMenu` now takes `variant?: "pill" | "sidebar"` (default `"pill"`, unchanged).
`variant="sidebar"` renders the full NavUser row as the dropdown trigger — same look
as `SidebarUser`, but clickable with the existing logout/profile menu. Drop it into
`sidebarFooter` and every Kumiko app gets the consistent account row.

renderer-web now also exports `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`
and `SidebarProvider` so apps can compose custom sidebar content.
