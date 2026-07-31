---
"@cosmicdrift/kumiko-renderer-web": minor
---

`WorkspaceShell` gains a `fill?: boolean` prop, mirroring `DefaultAppShell`'s existing viewport-fit mode: `true` pins the shell to `h-svh` and scrolls the content area instead of the whole page. Apps that mount long tables/lists through `WorkspaceShell` (solon, publicstatus, money-horse) can opt in per-screen the same way they already can with `DefaultAppShell`.
