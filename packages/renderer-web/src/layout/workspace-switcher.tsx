// WorkspaceSwitcher — dumb component for picking the active workspace.
// Receives the role-filtered + order-sorted workspace list, the active
// id, and a callback. Stays presentational so WorkspaceShell can own the
// state (URL ?w=, defaults, role filtering) and tests can hand any list
// in directly.
//
// Dropdown instead of a tab row: a row of fixed buttons overflowed the
// sidebar width with 3+ workspaces (or even 2 longer names) —
// truncate+scroll then hid the last entry entirely, unclickable. A
// dropdown has constant trigger width regardless of count/length.
//
// Hidden entirely when collapsed instead of an icon/initial: a label at
// icon width isn't readable anyway, and the user switches workspaces via
// the full sidebar — no attempt to keep this operable in the icon rail
// too (same as the search box in nav-tree.tsx).

import type { WorkspaceSchema } from "@cosmicdrift/kumiko-renderer";
import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import { ChevronsUpDown } from "lucide-react";
import type { ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../primitives/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";

export type WorkspaceSwitcherProps = {
  readonly workspaces: readonly WorkspaceSchema[];
  readonly activeId: string;
  readonly onSelect: (workspaceQn: string) => void;
  readonly testId?: string;
};

export function WorkspaceSwitcher({
  workspaces,
  activeId,
  onSelect,
  testId,
}: WorkspaceSwitcherProps): ReactNode {
  const t = useTranslation();
  // Single workspace doesn't need a switcher — the user has no choice
  // anyway. Render nothing instead of a useless one-button row.
  if (workspaces.length <= 1) return null;

  const labelOf = (ws: WorkspaceSchema): string =>
    ws.definition.label.includes(".") ? t(ws.definition.label) : ws.definition.label;
  const active = workspaces.find((ws) => ws.definition.id === activeId);

  return (
    <SidebarMenu
      data-testid={testId}
      data-kumiko-layout="workspace-switcher"
      className="group-data-[collapsible=icon]:hidden"
    >
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton data-testid="workspace-switcher-trigger">
              <span className="truncate">{active !== undefined ? labelOf(active) : ""}</span>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[10rem]">
            {workspaces.map((ws) => (
              <DropdownMenuCheckboxItem
                key={ws.definition.id}
                checked={ws.definition.id === activeId}
                data-testid={`workspace-tab-${ws.definition.id}`}
                onSelect={() => onSelect(ws.definition.id)}
              >
                <span className="truncate">{labelOf(ws)}</span>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
