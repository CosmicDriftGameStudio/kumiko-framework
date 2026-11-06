---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-testing": patch
---

Renderer review fixes: topbar actions in their own shell context, screen focus survives the unmount of a second reporter, nav collapse state is cleared on logout, dashboard phone line and pager and sort summary format like the cells and in the app locale, DOM tests reset web storage after each test.

<!-- kumiko-changes
feature: renderer
type: fix
title: Renderer review fixes for shell focus, logout and locale formatting
detail: `ShellTopbarActionsProvider` carries the shell's topbar actions in a context of its own, so `ShellFocusContext` consumers no longer re-render with every shell render and `useShellFocusHost` takes no argument. `useSetScreenFocus` only clears the focus it set itself. `clearNavCollapseState` runs on logout. The dashboard list phone line uses `dashboardListCellText` (bar as percent, i18n keys translated, `renderValue`), and the pager and the sort summary format numbers with the app locale.
-->
