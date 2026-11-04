import { normalizeListColumn } from "../screen-helpers.ts";
import type { ListColumnSpec } from "../types/screen.ts";
import { bootRuleError } from "./boot-rule.ts";
import { LIST_ROW_GUIDANCE_RULES } from "./list-row-guidance-rules.ts";
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

type NamedRowField = { readonly option: string; readonly value: string };

function guidanceRowFields(screen: RowGuidanceScreen): readonly NamedRowField[] {
  const named: NamedRowField[] = [];
  if (screen.rowToneField !== undefined) {
    named.push({ option: "rowToneField", value: screen.rowToneField });
  }
  for (const col of screen.columns) {
    const hint = normalizeListColumn(col).hint;
    if (hint === undefined) continue;
    if (hint.detailField !== undefined) {
      named.push({ option: "hint.detailField", value: hint.detailField });
    }
    if (hint.toneField !== undefined) {
      named.push({ option: "hint.toneField", value: hint.toneField });
    }
    if (hint.reasonField !== undefined) {
      named.push({ option: "hint.reasonField", value: hint.reasonField });
    }
  }
  return named;
}

export function validateListRowGuidance(
  featureName: string,
  screenId: string,
  kind: "entityList" | "projectionList" | "dashboard",
  screen: RowGuidanceScreen,
  entityFields?: EntityRowFields,
  panelId?: string,
): void {
  const where =
    kind === "dashboard"
      ? `[Feature ${featureName}] Screen "${screenId}" (dashboard) list-panel "${panelId ?? ""}"`
      : `[Feature ${featureName}] Screen "${screenId}" (${kind})`;
  for (const col of screen.columns) {
    const column = normalizeListColumn(col);
    if (column.hint !== undefined && column.renderer !== undefined) {
      throw bootRuleError(LIST_ROW_GUIDANCE_RULES.hintColumnRenderer, {
        message:
          `${where} column "${column.field}" sets both hint and renderer — the hint cell draws ` +
          `the column itself. Remove renderer or hint.`,
      });
    }
    if (column.hint !== undefined && column.display !== undefined) {
      throw bootRuleError(LIST_ROW_GUIDANCE_RULES.hintColumnDisplay, {
        message:
          `${where} column "${column.field}" sets both hint and display — the hint cell draws ` +
          `the column itself. Remove display or hint.`,
      });
    }
  }
  for (const { option, value } of guidanceRowFields(screen)) {
    if (value.trim().length === 0) {
      throw bootRuleError(LIST_ROW_GUIDANCE_RULES.guidanceFieldEmpty, {
        message: `${where} sets ${option} to an empty string. Name a row field or remove the option.`,
      });
    }
    if (entityFields !== undefined && !entityFields.fieldNames.has(value)) {
      throw bootRuleError(SCREEN_KIND_RULES.unknownFieldReference, {
        message: buildUnknownFieldMessage(
          featureName,
          screenId,
          value,
          entityFields.entityName,
          entityFields.fieldNames,
        ),
      });
    }
  }
}
