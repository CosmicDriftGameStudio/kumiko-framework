// @runtime client
// UserMenu — Avatar-Dropdown für die Topbar (variant="pill", Default) oder den
// Sidebar-Footer (variant="sidebar" = die sidebar-07-NavUser-Row). Zeigt
// Name/Email + Logout. Auf Radix-DropdownMenu, damit Click-outside, Escape,
// Focus-Management, Keyboard-Nav (↑↓/Home/End) und ARIA-Roles aus der Kiste
// funktionieren.
//
// Rendert NICHTS wenn kein User eingeloggt ist — Hosts dürfen das
// Component außerhalb des AuthGate einhängen ohne dass ein harter
// Fehler entsteht.

import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@cosmicdrift/kumiko-renderer-web";
import { ChevronDown, ChevronsUpDown, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { useSession } from "./session";

export type UserMenuVariant = "pill" | "sidebar";

export type UserMenuProps = {
  /** Zusätzliche Menu-Items über dem Logout. Per-item class/behaviour
   *  controlliert der Caller — wir packen nur den Frame drumrum. */
  readonly children?: ReactNode;
  /** "pill" (Default) = kompakter Topbar-Trigger; "sidebar" = volle NavUser-
   *  Row (Avatar + Name + Email) für den `sidebarFooter`-Slot der App-Shell.
   *  Requires a `SidebarProvider` ancestor — the default App-Shell
   *  `sidebarFooter` slot already provides one. */
  readonly variant?: UserMenuVariant;
};

function initials(value: string): string {
  // Vor- und Nachname falls Displayname einen Spacebar hat, sonst
  // erste zwei Chars der Email-Lokalseite. Deterministisch,
  // damit der Avatar-Content nicht bei jedem Re-Render flattert.
  const trimmed = value.trim();
  if (trimmed.length === 0) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0]?.[0] ?? "").concat(parts[1]?.[0] ?? "").toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export function UserMenu({ children, variant = "pill" }: UserMenuProps): ReactNode {
  const t = useTranslation();
  const { user, logout } = useSession();

  if (user === null) return null;

  const hasName = user.displayName.length > 0;
  const displayName = hasName ? user.displayName : user.email;
  const avatarText = initials(displayName);

  const content = (
    <DropdownMenuContent align="end" aria-label={t("auth.user.menu.label")}>
      <DropdownMenuLabel className="text-xs">
        <div className="font-medium text-foreground truncate">{displayName}</div>
        {hasName && <div className="truncate">{user.email}</div>}
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      {children}
      <DropdownMenuItem onSelect={() => void logout()}>
        <LogOut className="h-4 w-4" />
        <span>{t("auth.user.menu.logout")}</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  );

  // Sidebar-Footer: volle NavUser-Row (sidebar-07) als Dropdown-Trigger —
  // gleiche Optik wie SidebarUser, aber klickbar mit Logout/Profil.
  if (variant === "sidebar") {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <span
                  aria-hidden="true"
                  className="flex aspect-square size-8 items-center justify-center rounded-lg bg-muted text-xs font-medium text-muted-foreground"
                >
                  {avatarText}
                </span>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{displayName}</span>
                  {hasName && <span className="truncate text-xs">{user.email}</span>}
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            {content}
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* kumiko-lint-ignore primitives-discipline radix-asChild braucht DOM-Element als Trigger; Native kriegt eigene .native.tsx-Variante mit ActionSheet */}
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm",
            "text-foreground hover:bg-accent hover:text-accent-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          )}
        >
          <span
            aria-hidden="true"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
          >
            {avatarText}
          </span>
          <span className="hidden sm:inline max-w-[12ch] truncate">{displayName}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      {content}
    </DropdownMenu>
  );
}
