// SidebarBrand — logo tile, name and subtitle for DefaultAppShell's `brand`
// slot. Look only, no team-switch dropdown: an app usually has one identity;
// apps that need switching wrap their own dropdown around it and set
// `collapsible`.

import { ChevronsUpDown } from "lucide-react";
import type { ReactNode } from "react";

export type SidebarBrandProps = {
  /** Workspace/app name (bold, first line). */
  readonly name: string;
  /** Second line — plan, tagline, or tenant (small, dimmed). */
  readonly plan?: string;
  /** The tile typically contains a Lucide icon. If omitted, the first
   *  character of the name is shown. */
  readonly logo?: ReactNode;
  /** Shows the ChevronsUpDown icon only when the app wraps the brand in a
   *  dropdown. Default false: without a dropdown, the chevron misleadingly
   *  suggests a menu that does not open. */
  readonly collapsible?: boolean;
};

export function SidebarBrand({
  name,
  plan,
  logo,
  collapsible = false,
}: SidebarBrandProps): ReactNode {
  return (
    <div className="flex items-center gap-2.5 px-2 pt-1 pb-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 group-data-[focus-rail]/focus-rail:pt-0">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground group-data-[focus-rail]/focus-rail:size-8 group-data-[focus-rail]/focus-rail:rounded-md">
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
