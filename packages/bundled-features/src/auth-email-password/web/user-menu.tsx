// UserMenu — kleines Avatar-Dropdown in der Topbar. Zeigt Name/Email
// des aktuellen Users und rendert einen Logout-Button. Nutzt einen
// minimalen self-rolled Popup (click-outside + Escape-Close), damit
// das Feature keine Radix-Abhängigkeit braucht — der ui-Kern bleibt
// klein. Wer mehr (Profil-Link, Preferences, Theme-Toggle-Integration)
// will, kann den Menu-Body per Children-Prop reinreichen.
//
// Rendert bewusst NICHTS wenn kein User eingeloggt ist — Hosts dürfen
// das Component auch außerhalb des AuthGate einhängen (z.B. um eine
// Topbar zu bauen die im Login-Screen mit-angezeigt wird), ohne dass
// ein harter Fehler entsteht.

import { useTranslation } from "@kumiko/renderer";
import { type ClassValue, clsx } from "clsx";
import { ChevronDown, LogOut } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";
import { useSession } from "./session";

function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

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
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close on click outside + Escape. Beides ist Standard-Popup-Verhalten;
  // Radix würde das gleiche machen, nur mit fokus-trap on top. Kein
  // Focus-Trap hier — das Menu hat wenige Items und wir wollen die
  // Tab-Reihenfolge nicht blockieren.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent): void => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleLogout = useCallback(async () => {
    setOpen(false);
    await logout();
  }, [logout]);

  if (user === null) return null;

  const displayName = user.displayName.length > 0 ? user.displayName : user.email;
  const avatarText = initials(displayName);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
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
      {open && (
        <div
          role="menu"
          aria-label={t("auth.user.menu.label")}
          className={cn(
            "absolute right-0 z-50 mt-1 min-w-[12rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
            "animate-in fade-in-0 zoom-in-95",
          )}
        >
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            <div className="font-medium text-foreground truncate">{displayName}</div>
            <div className="truncate">{user.email}</div>
          </div>
          <div className="my-1 h-px bg-border" />
          {children}
          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
              "hover:bg-accent hover:text-accent-foreground",
              "focus-visible:outline-none focus-visible:bg-accent focus-visible:text-accent-foreground",
            )}
          >
            <LogOut className="h-4 w-4" />
            <span>{t("auth.user.menu.logout")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
