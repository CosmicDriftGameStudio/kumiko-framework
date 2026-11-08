// ShellHeader — inset header bar for sidebar-based shells: SidebarTrigger
// (rail/mobile-sheet toggle), breadcrumb of the active screen, optional
// right-aligned headerActions. Shared by DefaultAppShell and WorkspaceShell so
// both carry the same header (h-14, also with a collapsed icon rail).
//
// The `data-kumiko-layout="shell-header"` marker drives `--shell-header-height`
// in styles.css (:has() selector) — the single source for the header height
// that Drawer's `belowHeader` prop also reads.

import type { ScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { IN_APP_NOTIFICATION_FEATURE } from "@cosmicdrift/kumiko-types/in-app-notification-types";
import { ChevronLeft, MoreHorizontal } from "lucide-react";
import {
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { resolveNavigation } from "../../headless/index.ts";
import type { AppSchema, FeatureSchema } from "../../index.ts";
import {
  type ActionMenuItemSpec,
  lastSegment,
  toAppSchema,
  useNav,
  usePageHeaderCompact,
  useTranslation,
} from "../../index.ts";
import { Icon, NAV_ICONS } from "../icons.tsx";
import { cn } from "../lib/cn.ts";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../ui/breadcrumb.tsx";
import { SidebarTrigger } from "../ui/sidebar.tsx";
import { collectPinnedHeaderActions, isOnlyPinnedHeaderActions } from "./header-action-pinned.tsx";
import {
  HeaderOverflowMenuContext,
  HeaderScreenTypeContext,
  headerOverflowMenuItemClass,
} from "./header-overflow-menu.ts";
import { buildNavRegistrySliceForApp } from "./nav-tree.tsx";
import { NotificationBell } from "./notification-bell.tsx";
import { usePageHeaderSlot } from "./page-header-slot.tsx";
import {
  activeNavLabel,
  type BreadcrumbCrumb,
  resolveDetailBreadcrumb,
  screenTitleKey,
} from "./shell-breadcrumb.ts";
import { useShellFocused } from "./shell-focus.tsx";
import { useShellNavStyle } from "./shell-style.tsx";
import { SHELL_HEADER_CONTROLS_CLASSES } from "./uniform-bar-controls.ts";

type ShellHeaderUser = {
  readonly id: string;
  readonly roles: readonly string[];
};

export function ShellHeader({
  schema,
  user,
  headerActions: appHeaderActions,
  allowedNavQns,
  notificationBellPlacement = "header",
}: {
  readonly schema: AppSchema | FeatureSchema;
  readonly user?: ShellHeaderUser;
  readonly headerActions?: ReactNode;
  // The sidebar's nav set: when two navs point at the same screen, the title follows the one the sidebar shows.
  readonly allowedNavQns?: ReadonlySet<string>;
  readonly notificationBellPlacement?: "header" | "overflow";
}): ReactNode {
  const nav = useNav();
  const t = useTranslation();
  const focused = useShellFocused();
  const plainNav = useShellNavStyle() === "plain";
  // The app's headerActions (the assistant button) stay in focus mode: they are not navigation,
  // and a focused screen must not cut the user off from them. The notification bell is rendered
  // by this header itself, not passed in, and stays hidden; so does the sidebar trigger, except
  // with the plain nav style, whose panel symbol stays visible in focus mode.
  const headerActions = appHeaderActions;
  const appSchema = toAppSchema(schema);
  const tree = useMemo(() => {
    const source = buildNavRegistrySliceForApp(appSchema);
    return resolveNavigation({ source, ...(user !== undefined && { user }) });
  }, [appSchema, user]);
  const allowedTree = useMemo(() => {
    if (allowedNavQns === undefined) return undefined;
    const source = buildNavRegistrySliceForApp(appSchema, allowedNavQns);
    return resolveNavigation({ source, ...(user !== undefined && { user }) });
  }, [appSchema, user, allowedNavQns]);

  const allScreens = useMemo(
    () => appSchema.features.flatMap((f) => f.screens),
    [appSchema.features],
  );
  const hasInAppChannel = appSchema.features.some(
    (feature) => feature.featureName === IN_APP_NOTIFICATION_FEATURE,
  );
  const slot = usePageHeaderSlot();
  const standInScreenId = slot?.breadcrumbScreenId;
  const screenId = standInScreenId ?? nav.route?.screenId;
  // The qualified id wins: two features can share a short screen id.
  const screenType = (
    allScreens.find((s) => s.id === screenId) ??
    allScreens.find((s) => lastSegment(s.id) === screenId)
  )?.type;
  const entityId = standInScreenId !== undefined ? undefined : nav.route?.entityId;
  const crumbs = useMemo((): readonly BreadcrumbCrumb[] | undefined => {
    if (screenId === undefined) return undefined;
    // A nav entry on an edit screen means "create"; an existing record (entityId in
    // the route) is reached from the list, so the list crumb wins over the nav label.
    if (entityId !== undefined) {
      const detailCrumbs = resolveDetailBreadcrumb(allScreens, screenId, t);
      if (detailCrumbs !== undefined && detailCrumbs.length > 1) return detailCrumbs;
    }
    const navLabel =
      (allowedTree !== undefined ? activeNavLabel(allowedTree, screenId, t) : undefined) ??
      activeNavLabel(tree, screenId, t);
    if (navLabel !== undefined) return [{ label: navLabel }];
    return resolveDetailBreadcrumb(allScreens, screenId, t, {
      creating: standInScreenId === undefined && entityId === undefined,
    });
  }, [allScreens, screenId, standInScreenId, entityId, t, tree, allowedTree]);

  const setStatusElement = slot?.setStatusElement;
  const setActionsElement = slot?.setActionsElement;
  const titleOverride = slot?.title;
  const recordTitle = slot?.recordTitle;
  const compact = usePageHeaderCompact();
  const showsBell = !focused && user !== undefined && hasInAppChannel;
  const bellInOverflow = showsBell && notificationBellPlacement === "overflow";
  // A stand-in without a translated title must not surface the raw i18n key.
  const standInUntitled =
    standInScreenId !== undefined && crumbs?.at(-1)?.label === screenTitleKey(standInScreenId);
  const bodyTitle = slot?.bodyTitle === true;
  const baseCrumbs =
    (slot?.breadcrumbHidden === true && standInScreenId === undefined) || standInUntitled
      ? undefined
      : crumbs;
  const visibleCrumbs =
    baseCrumbs !== undefined && recordTitle !== undefined && baseCrumbs.length > 0
      ? [...baseCrumbs.slice(0, -1), { label: recordTitle }, ...baseCrumbs.slice(-1)]
      : baseCrumbs;
  // The screen's own title block is the h1, so the bar names the list the record belongs to. It is
  // picked from the nav crumbs, not from visibleCrumbs: a record title inserted there must not
  // take the parent's place.
  // Phone: only "‹ parent", never the screen's own title (the body shows it). Desktop: "parent › record title".
  // A screen that draws its own breadcrumb hides the bar's crumbs, but its parent link stays.
  const titleCrumbs = standInUntitled ? undefined : crumbs;
  const parentCrumb =
    titleCrumbs !== undefined && titleCrumbs.length > 1 ? titleCrumbs.at(-2) : undefined;
  // A record's short title replaces the "‹ parent" link on the phone; going back is the gesture or menu.
  const phoneRecordTitle = slot?.narrowRecordTitle ?? recordTitle;
  const phoneShowsRecordTitle = bodyTitle && compact && phoneRecordTitle !== undefined;
  const parentOnly = bodyTitle && compact && parentCrumb !== undefined && !phoneShowsRecordTitle;
  const bodyTitleCrumbs = (): readonly BreadcrumbCrumb[] => {
    if (phoneShowsRecordTitle) return [{ label: phoneRecordTitle }];
    if (compact) return parentCrumb === undefined ? [] : [parentCrumb];
    const ownTitle = recordTitle ?? titleCrumbs?.at(-1)?.label;
    return [
      ...(parentCrumb === undefined ? [] : [parentCrumb]),
      ...(ownTitle === undefined ? [] : [{ label: ownTitle }]),
    ];
  };
  const shownCrumbs = bodyTitle ? bodyTitleCrumbs() : visibleCrumbs;

  return (
    <header
      data-kumiko-layout="shell-header"
      {...(plainNav && { "data-nav-style": "plain" })}
      className={cn(
        "flex h-14 shrink-0 items-center gap-3 border-b border-border pl-1.5 pr-3 md:pl-4 md:pr-6",
        plainNav && "h-[58px] md:gap-2.5 md:px-5",
        (compact || bellInOverflow) && "relative",
        focused && "max-md:hidden",
      )}
    >
      {/* A size container: what the actions leave over decides whether the parent crumb still fits. */}
      <div className="@container flex min-w-0 flex-1 items-center gap-3">
        <ShellSidebarTrigger focused={focused} plainNav={plainNav} />
        {/* Compact: the status goes on its own line under the title, so the title keeps the width. */}
        <div
          className={cn("flex min-w-0", compact ? "flex-col justify-center" : "items-center gap-3")}
        >
          <ShellBreadcrumb
            crumbs={shownCrumbs}
            parentOnly={parentOnly}
            bodyTitle={bodyTitle}
            titleOverride={titleOverride}
          />
          <div
            ref={setStatusElement}
            data-kumiko-layout="page-header-status"
            className={cn(
              "flex items-center gap-2 empty:hidden",
              compact ? "min-w-0 max-w-full overflow-hidden whitespace-nowrap text-xs" : "shrink-0",
            )}
          />
        </div>
      </div>
      <HeaderScreenTypeContext.Provider value={screenType}>
        <ShellHeaderEnd
          compact={compact}
          actionsRef={setActionsElement}
          headerActions={headerActions}
          overflowItems={slot?.overflowItems ?? []}
          bellScreens={showsBell ? allScreens : undefined}
          bellInOverflow={bellInOverflow}
        />
      </HeaderScreenTypeContext.Provider>
    </header>
  );
}

function foldsIntoOverflow(
  overflowItems: readonly ActionMenuItemSpec[],
  headerActions: ReactNode,
): boolean {
  if (overflowItems.length > 0) return true;
  return headerActions !== undefined && !isOnlyPinnedHeaderActions(headerActions);
}

// On a phone the app's headerActions fold into the menu, except the ones wrapped in HeaderActionPinned.
function VisibleHeaderActions({
  compact,
  headerActions,
}: {
  readonly compact: boolean;
  readonly headerActions: ReactNode;
}): ReactNode {
  if (!compact) {
    if (headerActions === undefined) return null;
    return (
      <div data-kumiko-layout="header-actions" className="flex items-center gap-2">
        {headerActions}
      </div>
    );
  }
  const pinnedActions = collectPinnedHeaderActions(headerActions);
  if (pinnedActions.length === 0) return null;
  return (
    <div data-kumiko-layout="header-actions-pinned" className="flex items-center gap-2">
      {pinnedActions}
    </div>
  );
}

function ShellHeaderEnd({
  compact,
  actionsRef,
  headerActions,
  overflowItems,
  bellScreens,
  bellInOverflow,
}: {
  readonly compact: boolean;
  readonly actionsRef: Ref<HTMLDivElement> | undefined;
  readonly headerActions: ReactNode;
  readonly overflowItems: readonly ActionMenuItemSpec[];
  readonly bellScreens: readonly ScreenDefinition[] | undefined;
  readonly bellInOverflow: boolean;
}): ReactNode {
  const hasOverflow =
    bellInOverflow || (compact && foldsIntoOverflow(overflowItems, headerActions));
  return (
    <div
      className={cn(
        "ml-auto flex items-center gap-2",
        compact ? "min-w-0 max-w-[60%]" : "min-w-0 max-w-[50%] shrink-0 sm:max-w-none",
      )}
    >
      {/* Desktop: the app's actions (assistant) stand left of the screen's own actions and its "…" menu. */}
      {!compact && <VisibleHeaderActions compact={compact} headerActions={headerActions} />}
      <div
        ref={actionsRef}
        data-kumiko-layout="page-header-actions"
        className={cn(
          SHELL_HEADER_CONTROLS_CLASSES,
          "flex min-w-0 items-center gap-2 empty:hidden [&_*]:min-w-0 [&_*]:max-w-full [&_button]:overflow-hidden [&_button]:whitespace-nowrap",
          compact && "overflow-hidden",
        )}
      />
      {bellScreens !== undefined && !bellInOverflow && <NotificationBell screens={bellScreens} />}
      {compact && <VisibleHeaderActions compact={compact} headerActions={headerActions} />}
      {hasOverflow && (
        <HeaderOverflow
          items={compact ? overflowItems : []}
          headerActions={compact ? headerActions : undefined}
          {...(bellInOverflow && bellScreens !== undefined && { bellScreens })}
        />
      )}
    </div>
  );
}

function ShellSidebarTrigger({
  focused,
  plainNav,
}: {
  readonly focused: boolean;
  readonly plainNav: boolean;
}): ReactNode {
  const t = useTranslation();
  if (focused && !plainNav) return null;
  return (
    <SidebarTrigger
      label={t("kumiko.sidebar.toggle")}
      {...(plainNav && { icon: "panel-all-widths" as const })}
    />
  );
}

// A hand-rolled menu instead of Radix DropdownMenu: app headerActions are opaque
// nodes with their own popovers, and the panel stays mounted while closed so their
// effects (shortcut listeners) keep running.
const MENU_ITEM_SELECTOR = '[role="menuitem"]:not(:disabled)';
function OverflowBellEntry({
  screens,
  anchorRef,
  onSelect,
  separated,
}: {
  readonly screens: readonly ScreenDefinition[];
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly onSelect: () => void;
  readonly separated: boolean;
}): ReactNode {
  return (
    <>
      <NotificationBell screens={screens} menuEntry={{ anchorRef, onSelect }} />
      {separated && <hr className="-mx-1 my-1 border-t border-border" />}
    </>
  );
}

function HeaderOverflow({
  items,
  headerActions,
  bellScreens,
}: {
  readonly items: readonly ActionMenuItemSpec[];
  readonly headerActions: ReactNode;
  readonly bellScreens?: readonly ScreenDefinition[];
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
    // Opaque app headerActions (inputs, plain buttons) keep native Tab/arrow behaviour.
    if (
      !(event.target instanceof HTMLElement) ||
      event.target.getAttribute("role") !== "menuitem"
    ) {
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const menuItems = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR) ?? [],
    );
    if (menuItems.length === 0) return;
    const current = menuItems.indexOf(document.activeElement as HTMLElement);
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
        {bellScreens !== undefined && (
          <OverflowBellEntry
            screens={bellScreens}
            anchorRef={triggerRef}
            onSelect={() => setOpen(false)}
            separated={items.length > 0 || headerActions !== undefined}
          />
        )}
        {items.length > 0 && (
          <div className="flex flex-col">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={item.disabled === true}
                data-testid={item.testId ?? `shell-header-overflow-item-${item.id}`}
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
            // Stacks direct children only; app wrappers opt in via HeaderActionGroup instead of
            // being restyled through a child selector that reaches into their markup.
            className="flex flex-col items-stretch gap-1"
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

// The bar's breadcrumb: only the page title truncates, parents stay whole and leave when the space is too narrow.
function ShellBreadcrumb({
  crumbs,
  parentOnly,
  bodyTitle,
  titleOverride,
}: {
  readonly crumbs: readonly BreadcrumbCrumb[] | undefined;
  readonly parentOnly: boolean;
  readonly bodyTitle: boolean;
  readonly titleOverride: string | undefined;
}): ReactNode {
  const nav = useNav();
  const t = useTranslation();
  if (crumbs === undefined || crumbs.length === 0) return null;
  return (
    <Breadcrumb className="min-w-0" aria-label={t("kumiko.breadcrumb.label")}>
      <BreadcrumbList className="flex-nowrap gap-1.5 sm:gap-1.5">
        {crumbs.map((crumb, index) => {
          const screenId = crumb.screenId;
          const isLast = index === crumbs.length - 1;
          return (
            <Fragment key={screenId ?? crumb.label}>
              {index > 0 && (
                <BreadcrumbSeparator className="hidden text-muted-foreground @xs:inline-flex [&>svg]:size-3.5" />
              )}
              {/* Only the page title truncates; a shrinking parent crumb would slide under it,
                  so it stays whole and leaves when the space gets too narrow for both. */}
              <BreadcrumbItem
                className={cn(isLast ? "min-w-0" : "hidden shrink-0 @xs:inline-flex")}
              >
                {screenId !== undefined && (!isLast || parentOnly) ? (
                  <BreadcrumbLink
                    href="#"
                    className={cn(
                      "whitespace-nowrap text-foreground-secondary",
                      parentOnly && "text-[17px] font-semibold text-foreground",
                    )}
                    onClick={(e) => {
                      e.preventDefault();
                      nav.navigate({ screenId });
                    }}
                  >
                    {parentOnly && (
                      <ChevronLeft
                        className="me-0.5 inline size-4 align-text-bottom"
                        aria-hidden="true"
                      />
                    )}
                    {crumb.label}
                  </BreadcrumbLink>
                ) : isLast && bodyTitle ? (
                  <span className="truncate text-lg font-semibold text-foreground">
                    {crumb.label}
                  </span>
                ) : isLast ? (
                  <h1
                    aria-current="page"
                    title={titleOverride ?? crumb.label}
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
  );
}
