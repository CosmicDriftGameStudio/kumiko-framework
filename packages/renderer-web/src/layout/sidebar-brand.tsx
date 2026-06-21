// SidebarBrand — der TeamSwitcher-Header aus shadcns sidebar-07: Logo-Kachel +
// Name + Plan/Tagline. App-Author reicht ihn als `brand` an DefaultAppShell.
// Reiner Look (kein Team-Switch-Dropdown) — eine App hat meist EINE Identität;
// wer wechseln will, baut den Dropdown selbst drumrum und setzt `collapsible`.

import { ChevronsUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";

export type SidebarBrandProps = {
  /** Workspace-/App-Name (fett, erste Zeile). */
  readonly name: string;
  /** Zweite Zeile — Plan, Tagline, Tenant (klein, gedimmt). */
  readonly plan?: string;
  /** Logo in der Kachel — typisch ein Lucide-Icon. Fehlt es, steht der
   *  erste Buchstabe des Namens. */
  readonly logo?: ReactNode;
  /** Zeigt das ChevronsUpDown-Icon (Aufklapp-Affordance) nur wenn die App den
   *  Brand tatsächlich in ein Dropdown wrappt. Default false: ohne Dropdown
   *  ist das Chevron irreführend (suggeriert ein Menü, das nicht aufgeht). */
  readonly collapsible?: boolean;
};

export function SidebarBrand({
  name,
  plan,
  logo,
  collapsible = false,
}: SidebarBrandProps): ReactNode {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
        >
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            {logo ?? <span className="text-sm font-semibold">{name.charAt(0)}</span>}
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-semibold">{name}</span>
            {plan !== undefined && <span className="truncate text-xs">{plan}</span>}
          </div>
          {collapsible && <ChevronsUpDown className="ml-auto" />}
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
