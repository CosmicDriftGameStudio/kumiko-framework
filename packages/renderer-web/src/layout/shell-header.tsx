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
import {
  type ActionMenuItemSpec,
  toAppSchema,
  useNav,
  usePageHeaderCompact,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { MoreHorizontal } from "lucide-react";
import {
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icon, NAV_ICONS } from "../icons.js";
import { cn } from "../lib/cn.js";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../ui/breadcrumb.js";
import { SidebarTrigger } from "../ui/sidebar.js";
import { HeaderOverflowMenuContext, headerOverflowMenuItemClass } from "./header-overflow-menu.js";
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
  const recordTitle = slot?.recordTitle;
  const compact = usePageHeaderCompact();
  const overflowItems = slot?.overflowItems ?? [];
  const hasOverflow = compact && (overflowItems.length > 0 || headerActions !== undefined);
  const shownCrumbs =
    crumbs !== undefined && recordTitle !== undefined && crumbs.length > 0
      ? [...crumbs.slice(0, -1), { label: recordTitle }, ...crumbs.slice(-1)]
      : crumbs;

  return (
    <header
      data-kumiko-layout="shell-header"
      className={cn(
        "flex h-14 shrink-0 items-center gap-3 border-b border-border pl-1.5 pr-3 md:pl-4 md:pr-6",
        compact && "relative",
      )}
    >
      <div className={cn("flex min-w-0 items-center gap-3", compact && "flex-1")}>
        <SidebarTrigger />
        {shownCrumbs !== undefined && shownCrumbs.length > 0 && (
          <Breadcrumb className="min-w-0">
            <BreadcrumbList className="flex-nowrap gap-1.5 sm:gap-1.5">
              {shownCrumbs.map((crumb, index) => {
                const screenId = crumb.screenId;
                const isLast = index === shownCrumbs.length - 1;
                return (
                  <Fragment key={screenId ?? crumb.label}>
                    {index > 0 && (
                      <BreadcrumbSeparator className="hidden text-muted-foreground sm:inline-flex [&>svg]:size-3.5" />
                    )}
                    <BreadcrumbItem className={cn("min-w-0", !isLast && "hidden sm:inline-flex")}>
                      {screenId !== undefined && !isLast ? (
                        <BreadcrumbLink
                          href="#"
                          className="whitespace-nowrap text-foreground-secondary"
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
                        <BreadcrumbPage className="whitespace-nowrap text-foreground-secondary">
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
          className={cn(
            "flex items-center gap-2 empty:hidden",
            compact ? "min-w-0 overflow-hidden" : "shrink-0",
          )}
        />
      </div>
      <div
        className={cn(
          "ml-auto flex items-center gap-2",
          compact ? "shrink-0" : "min-w-0 max-w-[50%] shrink-0 sm:max-w-none",
        )}
      >
        <div
          ref={setActionsElement}
          data-kumiko-layout="page-header-actions"
          className={cn(
            "flex items-center gap-2 empty:hidden",
            !compact &&
              "min-w-0 [&_*]:min-w-0 [&_*]:max-w-full [&_button]:overflow-hidden [&_button]:whitespace-nowrap",
          )}
        />
        {!compact && headerActions !== undefined && (
          <div data-kumiko-layout="header-actions" className="flex items-center gap-2">
            {headerActions}
          </div>
        )}
        {hasOverflow && <HeaderOverflow items={overflowItems} headerActions={headerActions} />}
      </div>
    </header>
  );
}

// A hand-rolled menu instead of Radix DropdownMenu: app headerActions are opaque
// nodes with their own popovers, and the panel stays mounted while closed so their
// effects (shortcut listeners) keep running.
const MENU_ITEM_SELECTOR = '[role="menuitem"]:not(:disabled)';
function HeaderOverflow({
  items,
  headerActions,
}: {
  readonly items: readonly ActionMenuItemSpec[];
  readonly headerActions: ReactNode;
}): ReactNode {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>(MENU_ITEM_SELECTOR)?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const menuItems = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR) ?? [],
    );
    if (menuItems.length === 0) return;
    const current = menuItems.findIndex((item) => item === document.activeElement);
    const last = menuItems.length - 1;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? last
          : event.key === "ArrowDown"
            ? current >= last
              ? 0
              : current + 1
            : current <= 0
              ? last
              : current - 1;
    event.preventDefault();
    menuItems[next]?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={t("kumiko.page-header.actions")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        data-testid="shell-header-overflow-trigger"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-input bg-background text-foreground shadow-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <MoreHorizontal className="size-4" aria-hidden="true" />
      </button>
      <div
        ref={panelRef}
        id={panelId}
        role="menu"
        aria-label={t("kumiko.page-header.actions")}
        hidden={!open}
        onKeyDown={onPanelKeyDown}
        data-testid="shell-header-overflow"
        className="absolute right-2 top-full z-30 mt-1 w-max min-w-[8rem] max-w-[calc(100vw-1rem)] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      >
        {items.length > 0 && (
          <div className="flex flex-col">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={item.disabled === true}
                data-testid={`shell-header-overflow-item-${item.id}`}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={cn(
                  headerOverflowMenuItemClass,
                  item.variant === "danger" && "text-destructive",
                )}
              >
                {item.icon !== undefined && Object.hasOwn(NAV_ICONS, item.icon) && (
                  <Icon name={item.icon} className="size-4 shrink-0" />
                )}
                {item.label}
              </button>
            ))}
          </div>
        )}
        {items.length > 0 && headerActions !== undefined && (
          <hr className="-mx-1 my-1 border-t border-border" />
        )}
        {headerActions !== undefined && (
          // Clicks bubble up from the app's own buttons (keyboard activation fires click
          // too); closing here keeps the panel from staying open behind a dialog it opened.
          // biome-ignore lint/a11y/useKeyWithClickEvents: bubbled click from child buttons only
          // biome-ignore lint/a11y/noStaticElementInteractions: same, not an interactive target itself
          <div
            data-kumiko-layout="header-actions"
            // Apps wrap their nodes in a horizontal flex row; stacking it (and its direct
            // wrapper) lets menu rows like ThemeToggle take the full panel width.
            className="flex flex-col items-stretch gap-1 [&>div]:flex-col [&>div]:items-stretch"
            onClick={() => setOpen(false)}
          >
            <HeaderOverflowMenuContext.Provider value={true}>
              {headerActions}
            </HeaderOverflowMenuContext.Provider>
          </div>
        )}
      </div>
    </>
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
