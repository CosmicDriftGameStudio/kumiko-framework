import type { EmbeddedListEditSpec } from "@cosmicdrift/kumiko-framework/ui-types";
import { parseRefTarget } from "@cosmicdrift/kumiko-framework/ui-types";
import type { EmbeddedSubFieldDef } from "@cosmicdrift/kumiko-types/fields";
import { buildOptionLabels, embeddedCellLabelKey, embeddedCellOptionLabelKey } from "./list.ts";
import type { EmbeddedListCellViewModel, Translate } from "./types.ts";

type CellContext = {
  readonly translate: Translate;
  readonly featureName: string;
  readonly entityName: string;
  readonly fieldName: string;
  readonly listSpec: EmbeddedListEditSpec | undefined;
};

function selectHints(
  subField: EmbeddedSubFieldDef,
  subFieldName: string,
  ctx: CellContext,
): Partial<EmbeddedListCellViewModel> {
  if (subField.type !== "select") return {};
  return {
    options: subField.options,
    optionLabels: buildOptionLabels(
      ctx.translate,
      (value) =>
        embeddedCellOptionLabelKey(
          ctx.featureName,
          ctx.entityName,
          ctx.fieldName,
          subFieldName,
          value,
        ),
      subField.options,
    ),
    ...(subField.display !== undefined && { display: subField.display }),
    ...(subField.optionTones !== undefined && { optionTones: subField.optionTones }),
  };
}

function referenceHints(
  subField: EmbeddedSubFieldDef,
  featureName: string,
): Partial<EmbeddedListCellViewModel> {
  if (subField.type !== "reference") return {};
  const target = parseRefTarget(subField.entity, featureName);
  return {
    refEntity: target.entityName,
    refFeature: target.featureName,
    ...(subField.labelField !== undefined && { refLabelField: subField.labelField }),
    ...(subField.optionsQuery !== undefined && { refOptionsQuery: subField.optionsQuery }),
  };
}

function fileHints(subField: EmbeddedSubFieldDef): Partial<EmbeddedListCellViewModel> {
  if (subField.type !== "images" && subField.type !== "files") return {};
  return {
    ...(subField.maxCount !== undefined && { maxCount: subField.maxCount }),
    ...(subField.accept !== undefined && { accept: subField.accept }),
    ...(subField.type === "images" &&
      subField.capture !== undefined && { capture: subField.capture }),
  };
}

export function buildEmbeddedListCell(
  subFieldName: string,
  subField: EmbeddedSubFieldDef,
  ctx: CellContext,
): EmbeddedListCellViewModel {
  return {
    field: subFieldName,
    label: ctx.translate(
      embeddedCellLabelKey(ctx.featureName, ctx.entityName, ctx.fieldName, subFieldName),
    ),
    type: subField.type,
    required: subField.required === true,
    ...(subField.visibleWhen !== undefined && { visibleWhen: subField.visibleWhen }),
    ...(subField.requiredWhen !== undefined && { requiredWhen: subField.requiredWhen }),
    ...selectHints(subField, subFieldName, ctx),
    ...referenceHints(subField, ctx.featureName),
    ...(subField.type === "decimal" && subField.scale !== undefined && { scale: subField.scale }),
    ...fileHints(subField),
    ...(ctx.listSpec?.readOnlyCells?.includes(subFieldName) === true && { readOnly: true }),
    ...(ctx.listSpec?.cardHiddenCells?.includes(subFieldName) === true && { hiddenInCard: true }),
  };
}
