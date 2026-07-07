import type { ScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { lastSegment } from "./nav-tree";

export type BreadcrumbCrumb = {
  readonly label: string;
  readonly screenId?: string;
};

export function screenTitleKey(screenShortId: string): string {
  return `screen:${screenShortId}.title`;
}

export function resolveDetailBreadcrumb(
  screens: readonly ScreenDefinition[],
  detailScreenId: string,
  t: (key: string) => string,
): readonly BreadcrumbCrumb[] | undefined {
  const detail = screens.find((s) => lastSegment(s.id) === detailScreenId);
  if (detail === undefined) return undefined;

  const listFromRowAction = screens.find((s) => {
    if (s.type !== "entityList") return false;
    return (s.rowActions ?? []).some((a) => a.kind === "navigate" && a.screen === detailScreenId);
  });

  const listFromEntity =
    detail.type === "entityEdit"
      ? screens.find((s) => s.type === "entityList" && s.entity === detail.entity)
      : undefined;

  const listFromCustomParent =
    detail.type === "custom" && detail.listScreenId !== undefined
      ? screens.find((s) => lastSegment(s.id) === detail.listScreenId)
      : undefined;

  const list = listFromRowAction ?? listFromEntity ?? listFromCustomParent;
  if (list === undefined) {
    return [{ label: t(screenTitleKey(detailScreenId)) }];
  }

  const listId = lastSegment(list.id);
  return [
    { label: t(screenTitleKey(listId)), screenId: listId },
    { label: t(screenTitleKey(detailScreenId)) },
  ];
}
