// ShellHeader — inset header bar for sidebar-based shells: SidebarTrigger
// (rail/mobile-sheet toggle), breadcrumb of the active screen, optional
// right-aligned headerActions. Shared by DefaultAppShell and WorkspaceShell so
// both carry the same header (h-14, also with a collapsed icon rail).
//
// The `data-kumiko-layout="shell-header"` marker drives `--shell-header-height`
// in styles.css (:has() selector) — the single source for the header height
// that Drawer's `belowHeader` prop also reads.

import type { NavNode } from "@cosmicdrift/kumiko-headless";
import { resolveNavigation } from "@cosmicdrift/kumiko-headless";
import type { AppSchema, FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { toAppSchema, useNav, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { Fragment, type ReactNode, useMemo } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../ui/breadcrumb.js";
import { SidebarTrigger } from "../ui/sidebar.js";
import { buildNavRegistrySliceForApp, lastSegment } from "./nav-tree.js";
import { usePageHeaderSlot } from "./page-header-slot.js";
import { type BreadcrumbCrumb, resolveDetailBreadcrumb } from "./shell-breadcrumb.js";

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
  const appSchema = toAppSchema(schema);
  const tree = useMemo(() => {
    const source = buildNavRegistrySliceForApp(appSchema);
    return resolveNavigation({ source, ...(user !== undefined && { user }) });
  }, [appSchema, user]);

  const allScreens = useMemo(
    () => appSchema.features.flatMap((f) => f.screens),
    [appSchema.features],
  );
  const screenId = nav.route?.screenId;
  const entityId = nav.route?.entityId;
  const crumbs = useMemo((): readonly BreadcrumbCrumb[] | undefined => {
    if (screenId === undefined) return undefined;
    // A nav entry on an edit screen means "create"; an existing record (entityId in
    // the route) is reached from the list, so the list crumb wins over the nav label.
    if (entityId !== undefined) {
      const detailCrumbs = resolveDetailBreadcrumb(allScreens, screenId, t);
      if (detailCrumbs !== undefined && detailCrumbs.length > 1) return detailCrumbs;
    }
    const navLabel = activeNavLabel(tree, screenId, (k) => t(k));
    if (navLabel !== undefined) return [{ label: navLabel }];
    return resolveDetailBreadcrumb(allScreens, screenId, t);
  }, [allScreens, screenId, entityId, t, tree]);

  const slot = usePageHeaderSlot();
  const setStatusElement = slot?.setStatusElement;
  const setActionsElement = slot?.setActionsElement;
  const titleOverride = slot?.title;

  return (
    <header
      data-kumiko-layout="shell-header"
      className="flex h-14 shrink-0 items-center gap-3 border-b border-border pl-1.5 pr-3 md:pl-4 md:pr-6"
    >
      <div className="flex min-w-0 items-center gap-3">
        <SidebarTrigger />
        {crumbs !== undefined && crumbs.length > 0 && (
          <Breadcrumb className="min-w-0">
            <BreadcrumbList className="flex-nowrap gap-1.5 sm:gap-1.5">
              {crumbs.map((crumb, index) => {
                const screenId = crumb.screenId;
                const isLast = index === crumbs.length - 1;
                return (
                  <Fragment key={screenId ?? crumb.label}>
                    {index > 0 && (
                      <BreadcrumbSeparator className="text-muted-foreground [&>svg]:size-3.5" />
                    )}
                    <BreadcrumbItem className="min-w-0">
                      {screenId !== undefined && !isLast ? (
                        <BreadcrumbLink
                          href="#"
                          className="text-foreground-secondary"
                          onClick={(e) => {
                            e.preventDefault();
                            nav.navigate({ screenId });
                          }}
                        >
                          {crumb.label}
                        </BreadcrumbLink>
                      ) : isLast ? (
                        <h1
                          aria-current="page"
                          className="truncate text-lg font-semibold text-foreground"
                        >
                          {titleOverride ?? crumb.label}
                        </h1>
                      ) : (
                        <BreadcrumbPage className="text-foreground-secondary">
                          {crumb.label}
                        </BreadcrumbPage>
                      )}
                    </BreadcrumbItem>
                  </Fragment>
                );
              })}
            </BreadcrumbList>
          </Breadcrumb>
        )}
        <div
          ref={setStatusElement}
          data-kumiko-layout="page-header-status"
          className="flex shrink-0 items-center gap-2 empty:hidden"
        />
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <div
          ref={setActionsElement}
          data-kumiko-layout="page-header-actions"
          className="flex items-center gap-2 empty:hidden"
        />
        {headerActions !== undefined && (
          <div data-kumiko-layout="header-actions" className="flex items-center gap-2">
            {headerActions}
          </div>
        )}
      </div>
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
      return node.label.includes(".") || node.label.includes(":") ? t(node.label) : node.label;
    }
    const child = activeNavLabel(node.children, screenId, t);
    if (child !== undefined) return child;
  }
  return undefined;
}
