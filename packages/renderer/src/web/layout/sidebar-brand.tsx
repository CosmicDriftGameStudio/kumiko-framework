// SidebarBrand — logo tile, name and subtitle for DefaultAppShell's `brand`
// slot. Look only, no team-switch dropdown: an app usually has one identity;
// apps that need switching wrap their own dropdown around it and set
// `collapsible`.

import { ChevronsUpDown } from "lucide-react";
import type { ReactNode } from "react";

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
    <div className="flex items-center gap-2.5 px-2 pt-1 pb-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground">
        {logo ?? <span>{name.charAt(0)}</span>}
      </div>
      <div className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
        <span className="truncate text-sm font-semibold text-sidebar-foreground">{name}</span>
        {plan !== undefined && <span className="truncate text-xs text-sidebar-muted">{plan}</span>}
      </div>
      {collapsible && (
        <ChevronsUpDown className="ml-auto size-4 text-sidebar-muted group-data-[collapsible=icon]:hidden" />
      )}
    </div>
  );
}
