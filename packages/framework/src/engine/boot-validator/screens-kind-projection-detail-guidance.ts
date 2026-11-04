import type { ProjectionDetailScreenDefinition, RowAction } from "../types/screen.ts";
import { bootRuleError } from "./boot-rule.ts";
import { detailGuidanceFieldRefs } from "./query-output-guidance.ts";
import { validateActionHasIcon } from "./screens-actions.ts";
import { PROJECTION_DETAIL_RULES } from "./screens-kind-projection-detail-rules.ts";
import { type ScreenValidationContext, validateRecordHeaderAction } from "./screens-kind-shared.ts";

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
  for (const { option, field } of detailGuidanceFieldRefs(screen)) {
    if (field.trim().length === 0) {
      throw bootRuleError(PROJECTION_DETAIL_RULES.guidanceFieldEmpty, {
        message:
          `[Feature ${ctx.feature.name}] Screen "${screenId}" (projectionDetail) sets ${option} to ` +
          `an empty string. Name a query output field or remove the block.`,
      });
    }
  }
  if (screen.progress?.placement === "beside-steps" && screen.steps === undefined) {
    throw bootRuleError(PROJECTION_DETAIL_RULES.progressBesideStepsWithoutSteps, {
      message:
        `[Feature ${ctx.feature.name}] Screen "${screenId}" (projectionDetail) sets progress.placement ` +
        `"beside-steps" without steps. Add steps or remove the placement.`,
    });
  }
  for (const action of screen.banner?.actions ?? []) {
    validateGuidanceAction(ctx, screenId, screen, "banner", action);
  }
  for (const action of screen.steps?.actions ?? []) {
    validateGuidanceAction(ctx, screenId, screen, "steps", action);
  }
}
