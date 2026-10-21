import type { ReactNode } from "react";

export type SidebarProps = {
  /** Header area at the top — typically a workspace avatar, name, and badge.
   *  Sits ABOVE the scroll area and remains visible while the nav scrolls. */
  readonly header?: ReactNode;
  /** Action cluster between the header and nav — typically a "+ Neu" button
   *  and search icon. Linear pattern: prominent and outside the scroll area. */
  readonly actions?: ReactNode;
  /** NavTree and free-form sections (e.g. "Your teams" header and sub-items).
   *  Scrolls independently when the content becomes too long. */
  readonly children: ReactNode;
  /** Footer area at the bottom — typically an invite link, help, and plan banner.
   *  Sticks to the bottom via mt-auto. */
  readonly footer?: ReactNode;
  readonly testId?: string;
};

export function Sidebar({ header, actions, children, footer, testId }: SidebarProps): ReactNode {
  // Linear pattern: four vertical areas
  //   1. Header (workspace identity)
  //   2. Actions (non-scrolling quick buttons)
  //   3. Nav scroll area (NavTree, scrolling when needed)
  //   4. Footer (stays at the bottom via mt-auto)
  // bg-muted/40 + border-r distinguish the sidebar visually from the main area;
  // tighter padding (p-3) and a compact gap-0.5 between items.
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
