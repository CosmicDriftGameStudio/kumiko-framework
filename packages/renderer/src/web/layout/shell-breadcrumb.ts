import type { ScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { resolveNavParentScreen } from "@cosmicdrift/kumiko-framework/ui-types";
import type { NavNode } from "../../headless/index.ts";
import { lastSegment } from "../../index.ts";

export type BreadcrumbCrumb = {
  readonly label: string;
  readonly screenId?: string;
};

export function screenTitleKey(screenShortId: string): string {
  return `screen:${screenShortId}.title`;
}

export function screenCreateTitleKey(screenShortId: string): string {
  return `screen:${screenShortId}.createTitle`;
}

// An edit screen opened without a record creates one; a feature names that state with
// `createTitle`, and without it the screen title stays (t returns the key when untranslated).
function detailTitle(screenShortId: string, creating: boolean, t: (key: string) => string): string {
  if (creating) {
    const createKey = screenCreateTitleKey(screenShortId);
    const createTitle = t(createKey);
    if (createTitle !== createKey) return createTitle;
  }
  return t(screenTitleKey(screenShortId));
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
  options: { readonly creating?: boolean } = {},
): readonly BreadcrumbCrumb[] | undefined {
  const creating = options.creating === true;
  const detail = screens.find((s) => lastSegment(s.id) === detailScreenId);
  if (detail === undefined) return undefined;

  const list = resolveParentScreen(screens, detail);
  if (list === undefined) {
    return [{ label: detailTitle(detailScreenId, creating, t) }];
  }

  const listId = lastSegment(list.id);
  return [
    { label: t(screenTitleKey(listId)), screenId: listId },
    { label: detailTitle(detailScreenId, creating, t) },
  ];
}

export function activeNavLabel(
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
