import type { ScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { resolveNavParentScreen } from "@cosmicdrift/kumiko-framework/ui-types";
import { lastSegment } from "@cosmicdrift/kumiko-renderer";

export type BreadcrumbCrumb = {
  readonly label: string;
  readonly screenId?: string;
};

export function screenTitleKey(screenShortId: string): string {
  return `screen:${screenShortId}.title`;
}

// Delegates to resolveNavParentScreen, supplying the feature-qualified-id
// normalization the client-side schema needs.
function resolveParentScreen(
  screens: readonly ScreenDefinition[],
  detail: ScreenDefinition,
): ScreenDefinition | undefined {
  return resolveNavParentScreen(screens, detail, (s) => lastSegment(s.id));
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
