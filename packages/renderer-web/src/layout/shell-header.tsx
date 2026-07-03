// ShellHeader — die Inset-Kopfzeile für Sidebar-basierte Shells: SidebarTrigger
// (Rail-/Mobile-Sheet-Toggle) + Breadcrumb mit dem aktiven Screen + optionale
// rechtsbündige headerActions. Geteilt von DefaultAppShell und WorkspaceShell,
// damit beide dieselbe Kopfzeile tragen (Höhe h-16, kollabiert auf h-12 mit
// der Icon-Rail).

import type { NavNode } from "@cosmicdrift/kumiko-headless";
import { resolveNavigation } from "@cosmicdrift/kumiko-headless";
import type { AppSchema, FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { toAppSchema, useNav, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useMemo } from "react";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from "../ui/breadcrumb";
import { Separator } from "../ui/separator";
import { SidebarTrigger } from "../ui/sidebar";
import { buildNavRegistrySliceForApp, lastSegment } from "./nav-tree";

type ShellHeaderUser = {
  readonly id: string;
  readonly roles: readonly string[];
};

export function ShellHeader({
  schema,
  user,
  headerActions,
}: {
  readonly schema: AppSchema | FeatureSchema;
  readonly user?: ShellHeaderUser;
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
