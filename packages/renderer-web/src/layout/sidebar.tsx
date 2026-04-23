import type { ReactNode } from "react";

export type SidebarProps = {
  readonly children: ReactNode;
  readonly testId?: string;
};

export function Sidebar({ children, testId }: SidebarProps): ReactNode {
  return (
    <aside
      data-testid={testId}
      data-kumiko-layout="sidebar"
      className="w-56 flex-shrink-0 border-r bg-card p-4 overflow-auto flex flex-col gap-1 text-sm"
    >
      {children}
    </aside>
  );
}
