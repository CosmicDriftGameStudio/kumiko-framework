import { normalizeListColumn } from "../screen-helpers.ts";
import type { ListColumnSpec } from "../types/screen.ts";
import { type BootRule, bootRuleError } from "./boot-rule.ts";
import { LIST_ROW_GUIDANCE_RULES } from "./list-row-guidance-rules.ts";
import { listGuidanceFieldRefs } from "./query-output-guidance.ts";
import { SCREEN_KIND_RULES } from "./screens-kind-rules.ts";
import { buildUnknownFieldMessage } from "./screens-kind-shared.ts";

type RowGuidanceScreen = {
  readonly columns: readonly ListColumnSpec[];
  readonly rowToneField?: string;
};

// entityList passes the entity's field names, so row fields can be pinned; a
// projectionList has no field inventory and only gets the structural checks.
export type EntityRowFields = {
  readonly entityName: string;
  readonly fieldNames: ReadonlySet<string>;
};

type ListColumn = ReturnType<typeof normalizeListColumn>;

// The hint cell draws the column itself; these options would be silently ignored.
const HINT_CONFLICTS: readonly {
  readonly option: keyof ListColumn;
  readonly rule: BootRule;
}[] = [
  { option: "renderer", rule: LIST_ROW_GUIDANCE_RULES.hintColumnRenderer },
  { option: "display", rule: LIST_ROW_GUIDANCE_RULES.hintColumnDisplay },
  { option: "linkScreenField", rule: LIST_ROW_GUIDANCE_RULES.hintColumnLink },
  { option: "linkParamsField", rule: LIST_ROW_GUIDANCE_RULES.hintColumnLink },
  { option: "refEntity", rule: LIST_ROW_GUIDANCE_RULES.hintColumnLink },
  { option: "badgeToneField", rule: LIST_ROW_GUIDANCE_RULES.hintColumnLink },
];

function validateHintColumn(where: string, column: ListColumn): void {
  const conflict =
    column.hint === undefined
      ? undefined
      : HINT_CONFLICTS.find(({ option }) => column[option] !== undefined);
  if (conflict !== undefined) {
    throw bootRuleError(conflict.rule, {
      message:
        `${where} column "${column.field}" sets both hint and ${conflict.option} — the hint cell ` +
        `draws the column itself. Remove ${conflict.option} or hint.`,
    });
  }
}

type GuidanceListKind = "entityList" | "projectionList" | "dashboard" | "relatedList";

function guidanceLocation(
  featureName: string,
  screenId: string,
  kind: GuidanceListKind,
  partLabel: string,
): string {
  if (kind === "dashboard") {
    return `[Feature ${featureName}] Screen "${screenId}" (dashboard) list-panel "${partLabel}"`;
  }
  if (kind === "relatedList") return `[Feature ${featureName}] ${partLabel}`;
  return `[Feature ${featureName}] Screen "${screenId}" (${kind})`;
}

export function validateListRowGuidance(
  featureName: string,
  screenId: string,
  kind: GuidanceListKind,
  screen: RowGuidanceScreen,
  entityFields?: EntityRowFields,
  // dashboard: the list-panel id; relatedList: the section's full location text
  partLabel?: string,
): void {
  const where = guidanceLocation(featureName, screenId, kind, partLabel ?? "");
  for (const col of screen.columns) {
    validateHintColumn(where, normalizeListColumn(col));
  }
  for (const { option, field } of listGuidanceFieldRefs(screen)) {
    if (field.trim().length === 0) {
      throw bootRuleError(LIST_ROW_GUIDANCE_RULES.guidanceFieldEmpty, {
        message: `${where} sets ${option} to an empty string. Name a row field or remove the option.`,
      });
    }
    if (entityFields !== undefined && !entityFields.fieldNames.has(field)) {
      throw bootRuleError(SCREEN_KIND_RULES.unknownFieldReference, {
        message: buildUnknownFieldMessage(
          featureName,
          screenId,
          field,
          entityFields.entityName,
          entityFields.fieldNames,
        ),
      });
    }
  }
}
