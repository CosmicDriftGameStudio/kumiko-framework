// SidebarUser — der NavUser-Footer aus shadcns sidebar-07: Avatar + Name +
// Email + ChevronsUpDown. App-Author reicht ihn als `sidebarFooter` an
// DefaultAppShell. Reiner Look (kein Account-Dropdown) — wer ein User-Menü
// will, wrappt ihn in einen DropdownMenu.

import { ChevronsUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";

export type SidebarUserProps = {
  readonly name: string;
  readonly email?: string;
  /** Avatar-URL. Fehlt sie, stehen die Initialen aus dem Namen. */
  readonly avatar?: string;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : "";
  return (first + last).toUpperCase() || name.slice(0, 2).toUpperCase();
}

export function SidebarUser({ name, email, avatar }: SidebarUserProps): ReactNode {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
        >
          <Avatar className="size-8 rounded-lg">
            {avatar !== undefined && <AvatarImage src={avatar} alt={name} />}
            <AvatarFallback className="rounded-lg">{initials(name)}</AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-semibold">{name}</span>
            {email !== undefined && <span className="truncate text-xs">{email}</span>}
          </div>
          <ChevronsUpDown className="ml-auto size-4" />
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
