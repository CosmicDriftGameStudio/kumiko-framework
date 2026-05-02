// @runtime client
// UserMenu — Avatar-Dropdown in der Topbar/Sidebar. Zeigt Name/Email
// des aktuellen Users + Logout-Button. Auf Radix-DropdownMenu, damit
// Click-outside, Escape, Focus-Management, Keyboard-Nav (↑↓/Home/End)
// und ARIA-Roles aus der Kiste funktionieren.
//
// Rendert NICHTS wenn kein User eingeloggt ist — Hosts dürfen das
// Component außerhalb des AuthGate einhängen ohne dass ein harter
// Fehler entsteht.

import { useTranslation } from "@kumiko/renderer";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@kumiko/renderer-web";
import { ChevronDown, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { useSession } from "./session";

export type UserMenuProps = {
  /** Zusätzliche Menu-Items über dem Logout. Per-item class/behaviour
   *  controlliert der Caller — wir packen nur den Frame drumrum. */
  readonly children?: ReactNode;
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

export function UserMenu({ children }: UserMenuProps): ReactNode {
  const t = useTranslation();
  const { user, logout } = useSession();

  if (user === null) return null;

  const displayName = user.displayName.length > 0 ? user.displayName : user.email;
  const avatarText = initials(displayName);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
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
      <DropdownMenuContent align="end" aria-label={t("auth.user.menu.label")}>
        <DropdownMenuLabel className="text-xs">
          <div className="font-medium text-foreground truncate">{displayName}</div>
          <div className="truncate">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {children}
        <DropdownMenuItem onSelect={() => void logout()}>
          <LogOut className="h-4 w-4" />
          <span>{t("auth.user.menu.logout")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
