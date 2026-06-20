import type { ReactNode } from "react";

export type SidebarProps = {
  /** Header-Bereich oben — typisch Workspace-Avatar + Name + Badge.
   *  Lebt VOR dem scroll-area, bleibt sichtbar wenn das nav scrollt. */
  readonly header?: ReactNode;
  /** Action-Cluster zwischen Header und Nav — typisch "+ Neu" Button
   *  und Search-Icon. Linear-Pattern: prominent, nicht im scroll-area. */
  readonly actions?: ReactNode;
  /** NavTree + freie Sections (z.B. "Your teams" Header + Sub-Items).
   *  Scrollt eigenständig wenn der Inhalt zu lang wird. */
  readonly children: ReactNode;
  /** Footer-Bereich unten — typisch Invite-Link, Help, Plan-Banner.
   *  Klebt am unteren Rand via mt-auto. */
  readonly footer?: ReactNode;
  readonly testId?: string;
};

export function Sidebar({ header, actions, children, footer, testId }: SidebarProps): ReactNode {
  // Linear-Pattern: 4 vertikale Bereiche
  //   1. Header (Workspace-Identity)
  //   2. Actions (Quick-Buttons, nicht-scrollend)
  //   3. Nav-Scroll-Area (NavTree, scrollt wenn nötig)
  //   4. Footer (klebt unten via mt-auto)
  // bg-muted/40 + border-r für visuelle Distinction zur Main-Area;
  // tighter padding (p-3) und kompakte gap-0.5 zwischen Items.
  return (
    <aside
      data-testid={testId}
      data-kumiko-layout="sidebar"
      className="hidden md:flex w-60 flex-shrink-0 bg-transparent flex-col text-sm"
    >
      {header !== undefined && (
        <div
          data-kumiko-layout="sidebar-header"
          className="h-12 flex items-center px-3 border-b border-border/50"
        >
          {header}
        </div>
      )}
      {actions !== undefined && (
        <div
          data-kumiko-layout="sidebar-actions"
          className="px-3 py-2 border-b border-border/50 flex flex-row items-center gap-1"
        >
          {actions}
        </div>
      )}
      <div
        data-kumiko-layout="sidebar-nav"
        className="px-3 py-2 flex flex-col gap-0.5 overflow-auto flex-1"
      >
        {children}
      </div>
      {footer !== undefined && (
        <div
          data-kumiko-layout="sidebar-footer"
          className="px-3 py-2 border-t mt-auto flex flex-col gap-1 text-xs text-muted-foreground"
        >
          {footer}
        </div>
      )}
    </aside>
  );
}
