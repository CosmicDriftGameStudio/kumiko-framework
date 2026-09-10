import type { ScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { lastSegment } from "@cosmicdrift/kumiko-renderer";

export type BreadcrumbCrumb = {
  readonly label: string;
  readonly screenId?: string;
};

export function screenTitleKey(screenShortId: string): string {
  return `screen:${screenShortId}.title`;
}

// Every screen type carrying `listScreenId` declares it identically — reading
// it here (instead of at each call site) keeps the switch the only place
// that has to grow when a new screen type adopts the field.
function explicitListScreenId(screen: ScreenDefinition): string | undefined {
  switch (screen.type) {
    case "custom":
    case "projectionDetail":
    case "entityEdit":
    case "actionForm":
      return screen.listScreenId;
    default:
      return undefined;
  }
}

// Shared by the breadcrumb (this file) and NavTree's active-marker fallback
// (nav-tree.tsx) — both need "which list screen does this detail belong to",
// so this is the one place that answers it. An explicit `listScreenId` wins
// over the heuristics below (rowAction target / same-entity entityList): a
// screen author who declares it is opting out of the guess.
function resolveParentScreen(
  screens: readonly ScreenDefinition[],
  detail: ScreenDefinition,
): ScreenDefinition | undefined {
  const detailScreenId = lastSegment(detail.id);

  const listFromExplicit = ((): ScreenDefinition | undefined => {
    const explicitId = explicitListScreenId(detail);
    return explicitId !== undefined
      ? screens.find((s) => lastSegment(s.id) === explicitId)
      : undefined;
  })();

  const listFromRowAction = screens.find((s) => {
    if (s.type !== "entityList") return false;
    return (s.rowActions ?? []).some((a) => a.kind === "navigate" && a.screen === detailScreenId);
  });

  const listFromEntity =
    detail.type === "entityEdit"
      ? screens.find((s) => s.type === "entityList" && s.entity === detail.entity)
      : undefined;

  return listFromExplicit ?? listFromRowAction ?? listFromEntity;
}

/** The short id of {screenId}'s parent list screen, resolved via the same
 *  logic as `resolveDetailBreadcrumb` — `undefined` when nothing resolves
 *  (unknown screen, or no explicit/heuristic parent). */
export function resolveParentScreenId(
  screens: readonly ScreenDefinition[],
  screenId: string,
): string | undefined {
  const detail = screens.find((s) => lastSegment(s.id) === screenId);
  if (detail === undefined) return undefined;
  const parent = resolveParentScreen(screens, detail);
  return parent !== undefined ? lastSegment(parent.id) : undefined;
}

export function resolveDetailBreadcrumb(
  screens: readonly ScreenDefinition[],
  detailScreenId: string,
  t: (key: string) => string,
): readonly BreadcrumbCrumb[] | undefined {
  const detail = screens.find((s) => lastSegment(s.id) === detailScreenId);
  if (detail === undefined) return undefined;

  const list = resolveParentScreen(screens, detail);
  if (list === undefined) {
    return [{ label: t(screenTitleKey(detailScreenId)) }];
  }

  const listId = lastSegment(list.id);
  return [
    { label: t(screenTitleKey(listId)), screenId: listId },
    { label: t(screenTitleKey(detailScreenId)) },
  ];
}
