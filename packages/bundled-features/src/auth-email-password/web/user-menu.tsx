// UserMenu — avatar dropdown for the top bar (variant="pill", default) or the
// sidebar footer (variant="sidebar" = the sidebar-07-NavUser-Row). Shows
// name/email and logout. Uses Radix-DropdownMenu so click-outside, Escape,
// focus management, keyboard navigation (↑↓/Home/End), and ARIA roles work
// out of the box.
//
// Renders nothing when no user is logged in, so hosts can mount the component
// outside AuthGate without causing a hard error.

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
} from "@cosmicdrift/kumiko-renderer/web";
import { ChevronDown, ChevronsUpDown, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { useSession } from "./session.tsx";

export type UserMenuVariant = "pill" | "sidebar";

export type UserMenuProps = {
  /** Additional menu items above logout. The caller controls per-item
   *  classes and behavior; this component only provides the surrounding frame. */
  readonly children?: ReactNode;
  /** "pill" (default) = compact top-bar trigger; "sidebar" = full NavUser-
   *  row (avatar + name + email) for the App-Shell's `sidebarFooter` slot.
   *  Requires a `SidebarProvider` ancestor — the default App-Shell
   *  `sidebarFooter` slot already provides one. */
  readonly variant?: UserMenuVariant;
};

function initials(value: string): string {
  // Uses the first and last name when the display name contains a space;
  // otherwise uses the first two characters of the email local part. This is
  // deterministic, so the avatar content does not change between re-renders.
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
    <DropdownMenuContent
      align={variant === "sidebar" ? "start" : "end"}
      aria-label={t("auth.user.menu.label")}
    >
      <DropdownMenuLabel className="text-xs">
        <div className="font-medium text-foreground truncate">{displayName}</div>
        {hasName && <div className="truncate">{user.email}</div>}
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      {children !== undefined && (
        <>
          {children}
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuItem data-testid="user-menu-logout" onSelect={() => void logout()}>
        <LogOut className="h-4 w-4" />
        <span>{t("auth.user.menu.logout")}</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  );

  // Sidebar footer: full NavUser row (sidebar-07) as the dropdown trigger —
  // matches SidebarUser visually while providing clickable logout/profile actions.
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
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-medium text-sidebar-accent-foreground"
                >
                  {avatarText}
                </span>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium text-sidebar-foreground">
                    {displayName}
                  </span>
                  {hasName && (
                    <span className="truncate text-xs text-sidebar-muted">{user.email}</span>
                  )}
                </div>
                <ChevronsUpDown className="ml-auto size-4 text-sidebar-muted" />
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
        {/* kumiko-lint-ignore primitives-discipline radix-asChild requires a DOM element as the trigger; the native version in .native.tsx uses ActionSheet */}
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
