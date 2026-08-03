// WorkspaceSwitcher — dumb component for picking the active workspace.
// Receives the role-filtered + order-sorted workspace list, the active
// id, and a callback. Stays presentational so WorkspaceShell can own the
// state (URL ?w=, defaults, role filtering) and tests can hand any list
// in directly.
//
// Dropdown statt Tab-Reihe: eine Reihe fester Buttons lief mit 3+
// Workspaces (oder schon mit 2 längeren Namen) über die Sidebar-Breite
// hinaus — truncate+scroll versteckt dann den letzten Eintrag komplett
// unklickbar. Ein Dropdown hat dagegen bei jeder Anzahl/Länge konstante
// Trigger-Breite.

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
    <SidebarMenu data-testid={testId} data-kumiko-layout="workspace-switcher">
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton data-testid="workspace-switcher-trigger">
              <span className="truncate group-data-[collapsible=icon]:hidden">
                {active !== undefined ? labelOf(active) : ""}
              </span>
              <span aria-hidden="true" className="hidden group-data-[collapsible=icon]:inline">
                {active !== undefined ? labelOf(active).charAt(0).toUpperCase() : ""}
              </span>
              <ChevronsUpDown className="ml-auto group-data-[collapsible=icon]:hidden" />
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
