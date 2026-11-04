import type { ProjectionDetailScreenDefinition, RowAction } from "../types/screen.ts";
import { bootRuleError } from "./boot-rule.ts";
import { validateActionHasIcon } from "./screens-actions.ts";
import { PROJECTION_DETAIL_RULES } from "./screens-kind-projection-detail-rules.ts";
import { type ScreenValidationContext, validateRecordHeaderAction } from "./screens-kind-shared.ts";

type NamedField = { readonly option: string; readonly value: string | undefined };

function guidanceFields(screen: ProjectionDetailScreenDefinition): readonly NamedField[] {
  return [
    { option: "breadcrumb.field", value: screen.breadcrumb?.field },
    { option: "summary.field", value: screen.summary?.field },
    { option: "summary.toneField", value: screen.summary?.toneField },
    { option: "banner.field", value: screen.banner?.field },
    { option: "steps.field", value: screen.steps?.field },
    { option: "steps.subtitleField", value: screen.steps?.subtitleField },
  ];
}

function validateGuidanceAction(
  ctx: ScreenValidationContext,
  screenId: string,
  screen: ProjectionDetailScreenDefinition,
  block: "banner" | "steps",
  action: RowAction,
): void {
  const featureName = ctx.feature.name;
  validateActionHasIcon(featureName, screenId, "projectionDetail", `${block} action`, action);
  validateRecordHeaderAction(ctx, screenId, "projectionDetail", screen.detailFor, action);
  if (action.showOnTabs !== undefined) {
    throw bootRuleError(PROJECTION_DETAIL_RULES.guidanceActionShowOnTabs, {
      message:
        `[Feature ${featureName}] Screen "${screenId}" (projectionDetail) ${block} action ` +
        `"${action.id}" sets showOnTabs — ${block} actions sit outside the tabs. Remove showOnTabs.`,
    });
  }
}

// Field existence is pinned against the query's outputSchema in query-output-columns.ts.
export function validateProjectionDetailGuidance(
  ctx: ScreenValidationContext,
  screenId: string,
  screen: ProjectionDetailScreenDefinition,
): void {
  for (const { option, value } of guidanceFields(screen)) {
    if (value !== undefined && value.trim().length === 0) {
      throw bootRuleError(PROJECTION_DETAIL_RULES.guidanceFieldEmpty, {
        message:
          `[Feature ${ctx.feature.name}] Screen "${screenId}" (projectionDetail) sets ${option} to ` +
          `an empty string. Name a query output field or remove the block.`,
      });
    }
  }
  for (const action of screen.banner?.actions ?? []) {
    validateGuidanceAction(ctx, screenId, screen, "banner", action);
  }
  for (const action of screen.steps?.actions ?? []) {
    validateGuidanceAction(ctx, screenId, screen, "steps", action);
  }
}
