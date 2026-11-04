import type {
  ProjectionDetailScreenDefinition,
  ProjectionListScreenDefinition,
} from "@cosmicdrift/kumiko-types/screen";
import { normalizeListColumn } from "../screen-helpers.ts";

export type GuidanceFieldRef = { readonly option: string; readonly field: string };

function definedRefs(
  candidates: readonly { readonly option: string; readonly field: string | undefined }[],
): GuidanceFieldRef[] {
  return candidates.flatMap(({ option, field }) =>
    field === undefined ? [] : [{ option, field }],
  );
}

export function detailGuidanceFieldRefs(
  screen: ProjectionDetailScreenDefinition,
): readonly GuidanceFieldRef[] {
  return definedRefs([
    { option: "breadcrumb.field", field: screen.breadcrumb?.field },
    { option: "summary.field", field: screen.summary?.field },
    { option: "summary.toneField", field: screen.summary?.toneField },
    { option: "banner.field", field: screen.banner?.field },
    { option: "steps.field", field: screen.steps?.field },
    { option: "steps.subtitleField", field: screen.steps?.subtitleField },
    { option: "progress.field", field: screen.progress?.field },
    ...(screen.metrics ?? []).flatMap((metric) => [
      { option: "metrics.toneField", field: metric.toneField },
      { option: "metrics.subField", field: metric.subField },
    ]),
  ]);
}

export function listGuidanceFieldRefs(
  screen: Pick<ProjectionListScreenDefinition, "columns" | "rowToneField">,
): readonly GuidanceFieldRef[] {
  return definedRefs([
    { option: "rowToneField", field: screen.rowToneField },
    ...screen.columns.flatMap((col) => {
      const column = normalizeListColumn(col);
      const hint = column.hint;
      return [
        { option: "linkParamsField", field: column.linkParamsField },
        { option: "hint.detailField", field: hint?.detailField },
        { option: "hint.toneField", field: hint?.toneField },
        { option: "hint.reasonField", field: hint?.reasonField },
      ];
    }),
  ]);
}
