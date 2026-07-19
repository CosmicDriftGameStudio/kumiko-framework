// DefaultAppShell — die 90%-App-Shell auf Basis der vendored shadcn-Sidebar
// (src/ui/sidebar.tsx). SidebarProvider stellt den Context (Mobile-Sheet,
// Rail, Cmd-B), die Sidebar trägt die Chrome-Identität, SidebarInset rendert
// den schwebenden Content-Panel mit einem Header (Trigger + Breadcrumb).
//
// Sidebar-Slots:
//   1. brand          — Workspace-Identity oben (Logo + Name)
//   2. sidebarActions — Icon-Row (Search/Theme/Tenant-Switch)
//   3. NavTree        — automatisch aus dem Schema
//   4. sidebarFooter  — Bottom-Slot für Profile/Help/Plan-Banner
// Topbar-Slot:
//   headerActions     — rechtsbündig neben dem Breadcrumb (ThemeToggle etc.)
//
// Apps die feingranulare Kontrolle wollen, gehen direkt auf die ui/-Teile.
// Wer ein Topbar mit Workspace-Switcher braucht, nutzt <WorkspaceShell>.

import {
  type AppSchema,
  type FeatureSchema,
  UserRolesProvider,
} from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
} from "../ui/sidebar";
import { NavTree } from "./nav-tree";
import { ShellHeader } from "./shell-header";

export type DefaultAppShellUser = {
  readonly id: string;
  readonly roles: readonly string[];
};

export type DefaultAppShellProps = {
  /** Header-Slot oben in der Sidebar — Workspace-Identity (Logo, Name,
   *  Plan-Tag). Caller liefert frei. */
  readonly brand: ReactNode;
  /** Schema (AppSchema oder legacy FeatureSchema) wird an NavTree
   *  durchgereicht; Sidebar-Einträge bauen sich automatisch aus
   *  schema.navs (per-Feature) auf. */
  readonly schema: AppSchema | FeatureSchema;
  /** Current user — drives nav role-gating. Ohne user-prop werden
   *  role-gated nav-einträge (`access: { roles: [...] }`) komplett
   *  ausgeblendet (resolveNavigation behandelt undefined-user als
   *  anonymous). */
  readonly user?: DefaultAppShellUser;
  /** Icon-Row zwischen Brand und NavTree — typisch Search-Trigger,
   *  ThemeToggle, TenantSwitcher. */
  readonly sidebarActions?: ReactNode;
  /** Runtime-Badges pro Nav-Item (bare nav-id → ReactNode), an NavTree
   *  durchgereicht. Für Tier-/Status-Badges, die die App pro User liefert
   *  (Wert + Farbe), statt sie ins statische Schema zu backen. */
  readonly navBadges?: ReadonlyMap<string, ReactNode>;
  /** Rechtsbündiger Slot in der Topbar (neben dem Breadcrumb) — für
   *  ThemeToggle, globale Actions o.ä. Spart die eigene sidebarActions-
   *  Zeile in der Sidebar. */
  readonly headerActions?: ReactNode;
  /** Footer-Slot unten in der Sidebar — Profile-Row, Help-Link,
   *  Plan-Banner. */
  readonly sidebarFooter?: ReactNode;
  /** Viewport-fit Shell. true → fixe Viewport-Höhe (`h-svh`), der Content
   *  scrollt INNEN statt der ganzen Seite. Default false (Seiten-Scroll). */
  readonly fill?: boolean;
  /** Screen-Content der im SidebarInset gerendert wird. */
  readonly children: ReactNode;
};

export function DefaultAppShell({
  brand,
  schema,
  user,
  sidebarActions,
  headerActions,
  navBadges,
  sidebarFooter,
  fill,
  children,
}: DefaultAppShellProps): ReactNode {
  return (
    <SidebarProvider {...(fill === true && { className: "h-svh" })}>
      {/* sidebar-07-Muster: Standard-Variante (border-r, flush content) +
          collapsible="icon" — der Rail klappt auf Icon-Breite zu (Trigger/Rail). */}
      <Sidebar collapsible="icon">
        <SidebarHeader data-kumiko-layout="sidebar-header">{brand}</SidebarHeader>
        {sidebarActions !== undefined && (
          <SidebarGroup
            data-kumiko-layout="sidebar-actions"
            className="flex-row items-center gap-1 py-0"
          >
            {sidebarActions}
          </SidebarGroup>
        )}
        <SidebarContent data-kumiko-layout="sidebar-nav">
          <NavTree
            schema={schema}
            {...(user !== undefined && { user })}
            {...(navBadges !== undefined && { navBadges })}
          />
        </SidebarContent>
        {sidebarFooter !== undefined && (
          <SidebarFooter data-kumiko-layout="sidebar-footer">{sidebarFooter}</SidebarFooter>
        )}
        <SidebarRail />
      </Sidebar>
      <SidebarInset className={fill === true ? "min-h-0" : undefined}>
        <ShellHeader
          schema={schema}
          {...(user !== undefined && { user })}
          {...(headerActions !== undefined && { headerActions })}
        />
        <main className={fill === true ? "min-h-0 flex-1 overflow-auto" : "flex-1 overflow-auto"}>
          <UserRolesProvider roles={user?.roles}>{children}</UserRolesProvider>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
