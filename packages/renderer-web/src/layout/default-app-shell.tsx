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

import type { NavNode } from "@cosmicdrift/kumiko-headless";
import { resolveNavigation } from "@cosmicdrift/kumiko-headless";
import type { AppSchema, FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { toAppSchema, useNav, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useMemo } from "react";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from "../ui/breadcrumb";
import { Separator } from "../ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "../ui/sidebar";
import { buildNavRegistrySliceForApp, lastSegment, NavTree } from "./nav-tree";

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
          <NavTree schema={schema} {...(user !== undefined && { user })} />
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
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

// Inset-Header: hostet den SidebarTrigger (öffnet das Mobile-Sheet / toggled
// die Rail) und einen Breadcrumb mit dem aktiven Screen. Höhe == Sidebar-
// Header (h-12), damit Rail und Panel oben bündig sind.
function ShellHeader({
  schema,
  user,
  headerActions,
}: {
  readonly schema: AppSchema | FeatureSchema;
  readonly user?: DefaultAppShellUser;
  readonly headerActions?: ReactNode;
}): ReactNode {
  const nav = useNav();
  const t = useTranslation();
  const tree = useMemo(() => {
    const source = buildNavRegistrySliceForApp(toAppSchema(schema));
    return resolveNavigation({ source, ...(user !== undefined && { user }) });
  }, [schema, user]);

  const screenId = nav.route?.screenId;
  const label = screenId !== undefined ? activeNavLabel(tree, screenId, (k) => t(k)) : undefined;

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
      <div className="flex items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
        {label !== undefined && (
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>{label}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        )}
      </div>
      {headerActions !== undefined && (
        <div data-kumiko-layout="header-actions" className="ml-auto flex items-center gap-2 px-4">
          {headerActions}
        </div>
      )}
    </header>
  );
}

function activeNavLabel(
  nodes: readonly NavNode[],
  screenId: string,
  t: (key: string) => string,
): string | undefined {
  for (const node of nodes) {
    if (node.screen !== undefined && lastSegment(node.screen) === screenId) {
      return node.label.includes(".") ? t(node.label) : node.label;
    }
    const child = activeNavLabel(node.children, screenId, t);
    if (child !== undefined) return child;
  }
  return undefined;
}
