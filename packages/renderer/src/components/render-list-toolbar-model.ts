import type {
  EntityListScreenDefinition,
  ListToolbarActionsPlacement,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Translate } from "../headless/index.ts";
import { type ActionMenuItemSpec, shouldRenderActionsIconOnly } from "../primitives.tsx";
import { needsActionConfirm } from "./render-edit-action-button.tsx";
import type { ToolbarActionButton } from "./render-list-toolbar-action.tsx";

// Icon-less actions are promoted too; on phones the call site falls back to a
// "plus" icon, on desktop the label carries the action.
function isHeaderPromotableToolbarAction(action: ToolbarActionButton): boolean {
  return action.style === "primary" && !needsActionConfirm(action);
}

type ToolbarModelInput = {
  readonly toolbarActions: readonly ToolbarActionButton[] | undefined;
  readonly pageHeaderAvailable: boolean;
  readonly pageHeaderSlotAvailable: boolean;
  readonly pageHeaderCompact: boolean;
  readonly createInPageHeader: boolean;
  readonly toolbarActionsPlacement: ListToolbarActionsPlacement | undefined;
};

// Several icon-less primary actions would all show the same fallback "plus" icon, so it
// only applies to a sole one (same reasoning as the header's overflow menu below).
export function withPlusIconFallback(
  action: ToolbarActionButton,
  actions: readonly ToolbarActionButton[],
): ToolbarActionButton {
  const isIconlessPrimary = (a: ToolbarActionButton): boolean =>
    a.style === "primary" && a.icon === undefined;
  return isIconlessPrimary(action) && actions.filter(isIconlessPrimary).length === 1
    ? { ...action, icon: "plus" }
    : action;
}

export type ToolbarActionSplit = {
  readonly toolbarIconOnly: boolean;
  readonly promotedToolbarActions: readonly ToolbarActionButton[];
  readonly promotedInOverflowMenu: boolean;
  readonly toolbarActionsInToolbar: readonly ToolbarActionButton[];
  readonly hasToolbarActionsInToolbar: boolean;
  readonly actionsInToolbar: boolean;
};

export function splitToolbarActions(input: ToolbarModelInput): ToolbarActionSplit {
  const {
    toolbarActions,
    pageHeaderAvailable,
    pageHeaderSlotAvailable,
    pageHeaderCompact,
    createInPageHeader,
    toolbarActionsPlacement,
  } = input;
  // From md up; below it the compact header keeps the actions.
  const actionsInToolbar = toolbarActionsPlacement === "toolbar" && !pageHeaderCompact;
  const hasToolbarActions = toolbarActions !== undefined && toolbarActions.length > 0;
  const toolbarIconOnly = hasToolbarActions && shouldRenderActionsIconOnly(toolbarActions);
  // Every primary toolbar action takes the page-header slot, left of the create
  // button (which stays the rightmost primary action): labelled on desktop, so
  // projection lists look like entity lists. On phones an icon button, or, next to
  // the create button or beside another promoted action, an entry in the header's overflow
  // menu: the header has no room for labelled actions.
  const promotedToolbarActions =
    pageHeaderAvailable && pageHeaderSlotAvailable && !actionsInToolbar
      ? (toolbarActions?.filter(isHeaderPromotableToolbarAction) ?? [])
      : [];
  // Several icon-less actions would otherwise all show the same fallback "plus" icon.
  const promotedInOverflowMenu =
    pageHeaderCompact &&
    promotedToolbarActions.length > 0 &&
    (createInPageHeader || promotedToolbarActions.length > 1);
  const toolbarActionsInToolbar =
    toolbarActions?.filter((a) => !promotedToolbarActions.includes(a)) ?? [];
  const hasToolbarActionsInToolbar = toolbarActionsInToolbar.length > 0;
  return {
    toolbarIconOnly,
    promotedToolbarActions,
    promotedInOverflowMenu,
    toolbarActionsInToolbar,
    hasToolbarActionsInToolbar,
    actionsInToolbar,
  };
}

type MenuItemInput = {
  readonly promotedToolbarActions: readonly ToolbarActionButton[];
  readonly promotedInOverflowMenu: boolean;
  readonly menuActionBusyId: string | null;
  readonly setMenuActionBusyId: (id: string | null) => void;
  readonly setMenuActionError: (message: string | null) => void;
};

export function buildPromotedMenuItems(input: MenuItemInput): readonly ActionMenuItemSpec[] {
  const {
    promotedToolbarActions,
    promotedInOverflowMenu,
    menuActionBusyId,
    setMenuActionBusyId,
    setMenuActionError,
  } = input;
  return promotedInOverflowMenu
    ? promotedToolbarActions.map((a) => ({
        id: a.id,
        label: a.label,
        ...(a.icon !== undefined && { icon: a.icon }),
        ...(menuActionBusyId !== null && { disabled: true }),
        testId: `render-list-toolbar-action-${a.id}`,
        onSelect: () => {
          setMenuActionBusyId(a.id);
          setMenuActionError(null);
          void (async () => {
            try {
              await a.onTrigger();
            } catch (e) {
              setMenuActionError(e instanceof Error ? e.message : String(e));
            } finally {
              setMenuActionBusyId(null);
            }
          })();
        },
      }))
    : [];
}

type ListLabelInput = {
  readonly screen: EntityListScreenDefinition;
  readonly translate: Translate;
  readonly createLabel: string | undefined;
  readonly searchPlaceholder: string | undefined;
  readonly itemNounKey: string | undefined;
  readonly featureName: string;
};

export function resolveToolbarLabels(input: ListLabelInput) {
  const { screen, translate, createLabel, searchPlaceholder } = input;
  // i18n defaults for toolbar and empty-state strings. The caller can
  // override each one through a prop; otherwise the framework bundles provide
  // them (kumiko.actions.create, kumiko.list.search-placeholder, …).
  const effectiveCreateLabel = translate(
    createLabel ?? screen.createLabel ?? "kumiko.actions.create",
  );
  const effectiveSearchPlaceholder = translate(
    searchPlaceholder ?? screen.searchPlaceholder ?? "kumiko.list.search-placeholder",
  );
  return { effectiveCreateLabel, effectiveSearchPlaceholder };
}

export function resolveItemNoun(input: ListLabelInput): ((count: number) => string) | undefined {
  const { screen, translate, featureName } = input;
  const itemNounKey = input.itemNounKey ?? screen.itemNounKey;
  const nounKey = itemNounKey ?? `${featureName}:entity:${screen.entity}:noun`;
  return (itemNounKey !== undefined || !screen.entity.startsWith("__")) &&
    translate(nounKey, { count: 2 }) !== nounKey
    ? (count: number): string => translate(nounKey, { count })
    : undefined;
}

// Title resolution uses the conventional i18n key `screen:<id>.title`.
// If the bundle knows the key, use its translated title; otherwise use
// screenId so the app developer can see that the translation is missing.
export function resolveToolbarTitle(
  screen: EntityListScreenDefinition,
  translate: Translate,
): string {
  const titleKey = `screen:${screen.id}.title`;
  const resolvedTitle = translate(titleKey);
  return resolvedTitle === titleKey ? screen.id : resolvedTitle;
}
