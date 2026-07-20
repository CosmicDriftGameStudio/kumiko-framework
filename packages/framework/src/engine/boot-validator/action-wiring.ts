import { isExtensionEditSection, normalizeEditField, normalizeListColumn } from "../screen-helpers";
import type {
  EditFieldSpec,
  EditLayout,
  FeatureDefinition,
  ListColumnSpec,
  RowAction,
  ToolbarAction,
} from "../types";

const FUNCTION_DROPPED_HINT =
  "functions are dropped by JSON.stringify when the screen config reaches the client " +
  "bundle — the action/field silently no-ops at runtime instead of failing loudly.";

function throwIfFunction(value: unknown, message: string): void {
  if (typeof value === "function") {
    throw new Error(message);
  }
}

// rowActions/toolbarActions carry row-context extractors (payload/params),
// static visibility conditions and navigate entityId — all declarative-DSL-
// only fields (RowFieldExtractor's `{ pick }`/`{ map }`, FieldCondition's
// `{ field, eq }`/`{ field, ne }`, plain strings). A function literal here
// does not type-check against these structural DSL types — it only reaches
// here via a leaked `any`/`as any`, which this runtime check backstops.
const ACTION_FUNCTION_FIELDS = ["payload", "params", "entityId", "visible"] as const;

function validateActionNoFunctions(
  featureName: string,
  screenId: string,
  actionKind: "rowAction" | "toolbarAction",
  action: RowAction | ToolbarAction,
): void {
  const record = action as unknown as Record<string, unknown>;
  for (const field of ACTION_FUNCTION_FIELDS) {
    throwIfFunction(
      record[field],
      `[Feature ${featureName}] Screen "${screenId}" ${actionKind} "${action.id}" ${field} ` +
        `is a function — ${FUNCTION_DROPPED_HINT} Use the declarative DSL ({ pick }, { map }, ` +
        `"fieldName", { field, eq }) instead.`,
    );
  }
}

export function validateActionWiring(feature: FeatureDefinition): void {
  for (const screen of Object.values(feature.screens)) {
    if (screen.type !== "entityList" && screen.type !== "projectionList") continue;
    for (const action of screen.rowActions ?? []) {
      validateActionNoFunctions(feature.name, screen.id, "rowAction", action);
    }
    for (const action of screen.toolbarActions ?? []) {
      validateActionNoFunctions(feature.name, screen.id, "toolbarAction", action);
    }
  }
}

// EditFieldSpec's visible/readOnly/required are the same FieldCondition DSL
// as rowActions — same footgun, different screen type (entityEdit layouts).
const EDIT_FIELD_FUNCTION_FIELDS = ["visible", "readOnly", "required"] as const;

function validateEditFieldNoFunctions(
  featureName: string,
  screenId: string,
  screenType: string,
  fieldSpec: EditFieldSpec,
): void {
  const normalized = normalizeEditField(fieldSpec);
  const record = normalized as unknown as Record<string, unknown>;
  for (const key of EDIT_FIELD_FUNCTION_FIELDS) {
    throwIfFunction(
      record[key],
      `[Feature ${featureName}] Screen "${screenId}" (${screenType}) field "${normalized.field}" ` +
        `${key} is a function — ${FUNCTION_DROPPED_HINT} Use a FieldCondition ` +
        `(boolean or { field, eq }/{ field, ne }) instead.`,
    );
  }
  throwIfFunction(
    normalized.renderer,
    `[Feature ${featureName}] Screen "${screenId}" (${screenType}) field "${normalized.field}" ` +
      `renderer is a function — ${FUNCTION_DROPPED_HINT} Use a FormatSpec ({ format: "..." }) instead.`,
  );
}

function validateColumnsNoFunctions(
  featureName: string,
  screenId: string,
  screenType: string,
  columns: readonly ListColumnSpec[],
): void {
  for (const col of columns) {
    const normalized = normalizeListColumn(col);
    throwIfFunction(
      normalized.renderer,
      `[Feature ${featureName}] Screen "${screenId}" (${screenType}) column ` +
        `"${normalized.field}" renderer is a function — ${FUNCTION_DROPPED_HINT} ` +
        `Use a FormatSpec ({ format: "..." }) instead.`,
    );
  }
}

function validateEditLayoutNoFunctions(
  featureName: string,
  screenId: string,
  screenType: string,
  layout: EditLayout,
): void {
  for (const section of layout.sections) {
    if (isExtensionEditSection(section)) continue;
    for (const fieldSpec of section.fields) {
      validateEditFieldNoFunctions(featureName, screenId, screenType, fieldSpec);
    }
  }
}

// Screen types that carry an EditLayout (entityEdit's layout shape, reused
// verbatim by actionForm/configEdit/projectionDetail) vs. ones that carry
// ListColumnSpec[] (entityList/projectionList, plus dashboard "list" panels)
// both funnel through the same two checks below — a function literal in
// either shape is dropped by JSON.stringify regardless of which screen type
// hosts it.
export function validateFieldWiring(feature: FeatureDefinition): void {
  for (const screen of Object.values(feature.screens)) {
    if (screen.type === "entityList" || screen.type === "projectionList") {
      validateColumnsNoFunctions(feature.name, screen.id, screen.type, screen.columns);
      continue;
    }
    if (
      screen.type === "entityEdit" ||
      screen.type === "actionForm" ||
      screen.type === "configEdit" ||
      screen.type === "projectionDetail"
    ) {
      validateEditLayoutNoFunctions(feature.name, screen.id, screen.type, screen.layout);
      continue;
    }
    if (screen.type === "dashboard") {
      for (const panel of screen.panels) {
        if (panel.kind !== "list") continue;
        validateColumnsNoFunctions(
          feature.name,
          `${screen.id}:${panel.id}`,
          "dashboard-list",
          panel.columns,
        );
      }
    }
  }
}
