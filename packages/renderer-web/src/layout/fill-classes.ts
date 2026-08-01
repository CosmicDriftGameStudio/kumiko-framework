// Shared `fill`-prop wiring for the sidebar-based app shells
// (DefaultAppShell, WorkspaceShell) — both wrap the same vendored
// shadcn sidebar and need identical viewport-fit classes.
export const fillClasses = (fill?: boolean) => ({
  provider: fill === true ? { className: "h-svh" } : {},
  inset: fill === true ? "min-h-0" : undefined,
  main: fill === true ? "min-h-0 flex-1 overflow-auto" : "flex-1 overflow-auto",
});
