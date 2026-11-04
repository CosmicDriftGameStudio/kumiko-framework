import type { ProjectionDetailScreenDefinition, RowAction } from "../engine/types/screen.ts";

/** i18n references of the banner/steps blocks; `pushKey` filters out literal texts. */
export function pushDetailGuidanceKeys(
  detail: ProjectionDetailScreenDefinition,
  pushKey: (value: string | undefined) => void,
  pushRowActionKeys: (action: RowAction) => void,
): void {
  pushKey(detail.steps?.title);
  pushKey(detail.steps?.emptyLabel);
  for (const action of detail.banner?.actions ?? []) pushRowActionKeys(action);
  for (const action of detail.steps?.actions ?? []) pushRowActionKeys(action);
}
