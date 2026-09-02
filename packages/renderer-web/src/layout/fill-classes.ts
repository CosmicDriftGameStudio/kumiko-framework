// Shared `fill`-prop wiring for the sidebar-based app shells
// (DefaultAppShell, WorkspaceShell) — both wrap the same vendored
// shadcn sidebar and need identical viewport-fit classes.
//
// min-w-0 on the inset is unconditional (not fill-gated): vendored
// SidebarInset is `flex-1` with no min-width override, so a flex row child
// never shrinks below its content's intrinsic width by default. Wide screen
// content (e.g. a table with many columns) then grows the inset — and with
// it the whole sidebar row and the page — past the viewport instead of
// scrolling inside the inset's own `main` (which already has overflow-auto).
export const fillClasses = (fill?: boolean) => ({
  provider: fill === true ? { className: "h-svh" } : {},
  inset: fill === true ? "min-h-0 min-w-0" : "min-w-0",
  main: fill === true ? "min-h-0 flex-1 overflow-auto" : "flex-1 overflow-auto",
});
