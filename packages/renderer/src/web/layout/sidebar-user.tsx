// SidebarUser is the NavUser footer from shadcns sidebar-07: avatar + name +
// email + ChevronsUpDown. App authors pass it as `sidebarFooter` to
// DefaultAppShell. It is purely visual (no account dropdown); wrap it in a
// DropdownMenu to provide a user menu.

import { ChevronsUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar.tsx";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar.tsx";

export type SidebarUserProps = {
  readonly name: string;
  readonly email?: string;
  /** Avatar URL. When omitted, initials derived from the name are shown. */
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
          <Avatar className="size-7 bg-sidebar-accent">
            {avatar !== undefined && <AvatarImage src={avatar} alt={name} />}
            <AvatarFallback className="bg-sidebar-accent text-xs font-medium text-sidebar-accent-foreground">
              {initials(name)}
            </AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left leading-tight">
            <span className="truncate font-medium text-sidebar-foreground">{name}</span>
            {email !== undefined && (
              <span className="truncate text-xs text-sidebar-muted">{email}</span>
            )}
          </div>
          <ChevronsUpDown className="ml-auto size-4 text-sidebar-muted" />
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
