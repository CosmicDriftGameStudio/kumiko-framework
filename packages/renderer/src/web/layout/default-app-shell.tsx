// DefaultAppShell — the 90% app shell based on the vendored shadcn sidebar
// (src/ui/sidebar.tsx). SidebarProvider supplies the context (mobile sheet,
// rail, Cmd-B); Sidebar provides the chrome identity, and SidebarInset renders
// the floating content panel with a header (trigger + breadcrumb).
//
// Sidebar slots:
//   1. brand          — workspace identity at the top (logo + name)
//   2. sidebarActions — icon row (Search/Theme/Tenant-Switch)
//   3. NavTree        — generated automatically from the schema
//   4. sidebarFooter  — bottom slot for profile/help/plan banner
// Topbar slot:
//   headerActions     — aligned to the right of the breadcrumb (ThemeToggle etc.)
//
// Apps that need granular control can use the ui/ components directly.
// Apps that need a topbar with a workspace switcher should use <WorkspaceShell>.

import type { CSSProperties, ReactNode } from "react";
import {
  type AppSchema,
  type FeatureSchema,
  UserRolesProvider,
  useTranslation,
} from "../../index.ts";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
  useSidebar,
} from "../ui/sidebar.tsx";
import { fillClasses } from "./fill-classes.ts";
import { FocusRail } from "./focus-rail.tsx";
import { NavTree } from "./nav-tree.tsx";
import { PageHeaderSlotProvider } from "./page-header-slot.tsx";
import { ShellFocusProvider, useShellFocusHost } from "./shell-focus.tsx";
import { ShellHeader } from "./shell-header.tsx";
import { SidebarPanelProvider, useSidebarPanelHost } from "./sidebar-panel.tsx";

export type DefaultAppShellUser = {
  readonly id: string;
  readonly roles: readonly string[];
};

export type DefaultAppShellProps = {
  /** Header slot at the top of the sidebar — workspace identity (logo, name,
   *  plan tag). The caller provides the content. */
  readonly brand: ReactNode;
  /** Schema (AppSchema or legacy FeatureSchema) passed through to NavTree;
   *  sidebar entries are generated automatically from
   *  schema.navs (per-feature). */
  readonly schema: AppSchema | FeatureSchema;
  /** Current user — drives navigation role gating. Without a user prop,
   *  role-gated navigation entries (`access: { roles: [...] }`) are hidden
   *  completely (resolveNavigation treats an undefined user as anonymous). */
  readonly user?: DefaultAppShellUser;
  /** Icon row between the brand and NavTree — typically a Search trigger,
   *  ThemeToggle, or TenantSwitcher. */
  readonly sidebarActions?: ReactNode;
  /** Runtime badges per navigation item (bare nav-id → ReactNode), passed
   *  through to NavTree. For tier/status badges supplied by the app per user
   *  (value + color), rather than embedded in the static schema. */
  readonly navBadges?: ReadonlyMap<string, ReactNode>;
  /** Right-aligned slot in the topbar (next to the breadcrumb) — for
   *  ThemeToggle, global actions, and similar controls. Avoids a separate
   *  sidebarActions row in the sidebar. */
  readonly headerActions?: ReactNode;
  /** Footer slot at the bottom of the sidebar — profile row, help link,
   *  or plan banner. */
  readonly sidebarFooter?: ReactNode;
  /** Viewport-fit shell. true → fixed viewport height (`h-svh`); content
   *  scrolls inside instead of the whole page. Defaults to true — `fill={false}`
   *  switches back to page scrolling. */
  readonly fill?: boolean;
  /** Screen content rendered inside SidebarInset. */
  readonly children: ReactNode;
};

// 3.5rem = the 56px rail of the focused screen; the default icon width stays 3rem.
const FOCUS_RAIL_WIDTH_STYLE: CSSProperties = { "--sidebar-width-icon": "3.5rem" };

function FocusAwareSidebarBody({
  focused,
  brand,
  schema,
  user,
  children,
}: {
  readonly focused: boolean;
  readonly brand: ReactNode;
  readonly schema: AppSchema | FeatureSchema;
  readonly user: DefaultAppShellUser | undefined;
  readonly children: ReactNode;
}): ReactNode {
  const { state, isMobile } = useSidebar();
  if (focused && state === "collapsed" && !isMobile) {
    return <FocusRail brand={brand} schema={schema} {...(user !== undefined && { user })} />;
  }
  return children;
}

export function DefaultAppShell({
  brand,
  schema,
  user,
  sidebarActions,
  headerActions,
  navBadges,
  sidebarFooter,
  fill = true,
  children,
}: DefaultAppShellProps): ReactNode {
  const fillCls = fillClasses(fill);
  const t = useTranslation();
  // Second column only when a screen fills it (sidebar-09 pattern) — otherwise
  // every other screen would carry an empty strip next to the navigation.
  const panel = useSidebarPanelHost();
  const focus = useShellFocusHost();
  return (
    <SidebarProvider
      {...fillCls.provider}
      {...(focus.focused && {
        open: focus.railOpen,
        onOpenChange: focus.setRailOpen,
        style: FOCUS_RAIL_WIDTH_STYLE,
      })}
    >
      <ShellFocusProvider value={focus.value}>
        <SidebarPanelProvider value={panel.value}>
          {/* Standard variant (border-r, flush content) + collapsible="icon" — the rail collapses to icon width (trigger/rail). */}
          <Sidebar
            collapsible="icon"
            mobileTitle={t("kumiko.sidebar.title")}
            mobileDescription={t("kumiko.sidebar.description")}
          >
            <FocusAwareSidebarBody
              focused={focus.focused}
              brand={brand}
              schema={schema}
              user={user}
            >
              <SidebarHeader data-kumiko-layout="sidebar-header">{brand}</SidebarHeader>
              {sidebarActions !== undefined && (
                <SidebarGroup
                  data-kumiko-layout="sidebar-actions"
                  className="flex-row flex-wrap items-center gap-1 py-0"
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
                <SidebarFooter
                  data-kumiko-layout="sidebar-footer"
                  className="border-t border-sidebar-border"
                >
                  {sidebarFooter}
                </SidebarFooter>
              )}
            </FocusAwareSidebarBody>
            <SidebarRail
              aria-label={t("kumiko.sidebar.toggle")}
              title={t("kumiko.sidebar.toggle")}
            />
          </Sidebar>
          <div
            ref={panel.ref}
            data-kumiko-layout="sidebar-panel"
            className={panel.occupied ? "flex h-svh shrink-0 flex-col" : "hidden"}
          />
          <SidebarInset className={fillCls.inset}>
            <PageHeaderSlotProvider>
              <ShellHeader
                schema={schema}
                {...(user !== undefined && { user })}
                {...(headerActions !== undefined && { headerActions })}
              />
              <main className={fillCls.main}>
                <UserRolesProvider roles={user?.roles}>{children}</UserRolesProvider>
              </main>
            </PageHeaderSlotProvider>
          </SidebarInset>
        </SidebarPanelProvider>
      </ShellFocusProvider>
    </SidebarProvider>
  );
}
