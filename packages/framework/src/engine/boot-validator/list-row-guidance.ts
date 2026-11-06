import type {
  NamedFilterFacetOptions,
  NamedListFilterRef,
} from "@cosmicdrift/kumiko-types/named-list-filters";
import { normalizeListColumn } from "../screen-helpers.ts";
import type { ListColumnSpec } from "../types/screen.ts";
import { type BootRule, bootRuleError } from "./boot-rule.ts";
import { LIST_ROW_GUIDANCE_RULES } from "./list-row-guidance-rules.ts";
import { NAMED_FILTER_RULES } from "./named-filter-rules.ts";
import { listGuidanceFieldRefs } from "./query-output-guidance.ts";
import { acceptsRowDecorationField, type RowDecorationFields } from "./row-decoration.ts";
import { SCREEN_KIND_RULES } from "./screens-kind-rules.ts";
import { buildUnknownFieldMessage } from "./screens-kind-shared.ts";

type RowGuidanceScreen = {
  readonly columns: readonly ListColumnSpec[];
  readonly namedFilters?: readonly NamedListFilterRef[];
  readonly namedFilterFacet?: NamedFilterFacetOptions;
  readonly rowToneField?: string;
  readonly rowDecoration?: { readonly query: string };
};

// entityList passes the entity's field names, so row fields can be pinned; a
// projectionList has no field inventory and only gets the structural checks.
export type EntityRowFields = {
  readonly entityName: string;
  readonly fieldNames: ReadonlySet<string>;
  readonly rowDecorationFields?: RowDecorationFields | undefined;
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
  { option: "badgeDot", rule: LIST_ROW_GUIDANCE_RULES.hintColumnLink },
  { option: "emptyPlaceholder", rule: LIST_ROW_GUIDANCE_RULES.hintColumnEmptyPlaceholder },
];

function validateHintColumn(where: string, column: ListColumn): void {
  if (column.hint?.narrowDetailField !== undefined && column.hint.detailField === undefined) {
    throw bootRuleError(LIST_ROW_GUIDANCE_RULES.narrowDetailFieldWithoutDetailField, {
      message: `${where} column "${column.field}" sets hint.narrowDetailField without hint.detailField. Set detailField or remove narrowDetailField.`,
    });
  }
  const { hint } = column;
  if (
    hint !== undefined &&
    hint.reasonField === undefined &&
    (hint.reasonOpenField !== undefined || hint.reasonTitleField !== undefined)
  ) {
    throw bootRuleError(LIST_ROW_GUIDANCE_RULES.reasonOptionWithoutReasonField, {
      message: `${where} column "${column.field}" sets hint.reasonOpenField or hint.reasonTitleField without hint.reasonField. Set reasonField or remove them.`,
    });
  }
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

// hideOnNarrow and hidden: false are legal alongside showOnNarrowOnly; a pin always conflicts.
function narrowOnlyConflictOf(column: ListColumn): string | undefined {
  if (column.hideOnNarrow === true) return "hideOnNarrow";
  if (column.hidden === true) return "hidden";
  return column.pinned !== undefined ? "pinned" : undefined;
}

function validateNarrowOnlyColumn(where: string, column: ListColumn): void {
  // skip: the column shows in the table too
  if (column.showOnNarrowOnly === undefined) return;
  const conflict = narrowOnlyConflictOf(column);
  if (conflict !== undefined) {
    throw bootRuleError(LIST_ROW_GUIDANCE_RULES.narrowOnlyConflict, {
      message: `${where} column "${column.field}" sets showOnNarrowOnly together with ${conflict}. Remove one of them.`,
    });
  }
}

function validateButtonColumn(where: string, column: ListColumn, kind: GuidanceListKind): void {
  if (column.display === "button" && kind !== "dashboard") {
    throw bootRuleError(LIST_ROW_GUIDANCE_RULES.buttonColumnInListTable, {
      message:
        `${where} column "${column.field}" sets display "button", which only dashboard list panels draw. ` +
        `A row button in a list table is a rowAction with display "button".`,
    });
  }
  const hasLink = column.linkScreenField !== undefined || column.refEntity !== undefined;
  if (column.display === "button" && !hasLink) {
    throw bootRuleError(LIST_ROW_GUIDANCE_RULES.buttonColumnWithoutLink, {
      message:
        `${where} column "${column.field}" sets display "button" without linkScreenField or refEntity ` +
        `— the button is the link. Set a link option or remove display.`,
    });
  }
}

function validateNamedFilterOptions(where: string, screen: RowGuidanceScreen): void {
  if (screen.namedFilterFacet !== undefined && (screen.namedFilters ?? []).length === 0) {
    throw bootRuleError(NAMED_FILTER_RULES.facetWithoutFilters, {
      message: `${where} sets namedFilterFacet without namedFilters — there is nothing to present. Declare namedFilters or remove namedFilterFacet.`,
    });
  }
  for (const ref of screen.namedFilters ?? []) {
    const { emptyState } = ref;
    if (emptyState === undefined) continue;
    if (emptyState.title.trim().length === 0) {
      throw bootRuleError(NAMED_FILTER_RULES.emptyStateTitleEmpty, {
        message: `${where} namedFilters "${ref.id}" sets emptyState with an empty title. Name the i18n key or remove emptyState.`,
      });
    }
    if (emptyState.paramsQuery !== undefined && emptyState.paramsQuery.trim().length === 0) {
      throw bootRuleError(NAMED_FILTER_RULES.emptyStateParamsQueryEmpty, {
        message: `${where} namedFilters "${ref.id}" sets emptyState.paramsQuery to an empty string. Name the query or remove paramsQuery.`,
      });
    }
    if (emptyState.paramsQuery !== undefined && emptyState.description === undefined) {
      throw bootRuleError(NAMED_FILTER_RULES.emptyStateParamsQueryWithoutDescription, {
        message: `${where} namedFilters "${ref.id}" sets emptyState.paramsQuery without a description — the params only feed the description. Set description or remove paramsQuery.`,
      });
    }
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
  if (screen.rowDecoration !== undefined && screen.rowDecoration.query.trim().length === 0) {
    throw bootRuleError(LIST_ROW_GUIDANCE_RULES.rowDecorationQueryEmpty, {
      message: `${where} sets rowDecoration.query to an empty string. Name the decoration query or remove rowDecoration.`,
    });
  }
  for (const col of screen.columns) {
    const column = normalizeListColumn(col);
    validateHintColumn(where, column);
    validateNarrowOnlyColumn(where, column);
    validateButtonColumn(where, column, kind);
  }
  validateNamedFilterOptions(where, screen);
  for (const { option, field } of listGuidanceFieldRefs(screen)) {
    if (field.trim().length === 0) {
      throw bootRuleError(LIST_ROW_GUIDANCE_RULES.guidanceFieldEmpty, {
        message: `${where} sets ${option} to an empty string. Name a row field or remove the option.`,
      });
    }
    if (
      entityFields !== undefined &&
      !entityFields.fieldNames.has(field) &&
      !acceptsRowDecorationField(entityFields.rowDecorationFields, field)
    ) {
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
