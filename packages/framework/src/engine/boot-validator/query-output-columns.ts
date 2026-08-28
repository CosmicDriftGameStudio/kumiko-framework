import type { ZodType } from "zod";
import { isPagedQueryHandler } from "../define-handler";
import { normalizeListColumn } from "../screen-helpers";
import type {
  DashboardScreenDefinition,
  DashboardStatPanel,
  EditLayout,
  FeatureDefinition,
  ListColumnSpec,
  ProjectionDetailScreenDefinition,
  ProjectionListScreenDefinition,
  QueryHandlerDef,
  ScreenDefinition,
} from "../types";
import { buildQueryHandlerMap } from "./projection-list-screens";
import { getZodObjectShape, getZodRowShape } from "./zod-shape";

// fw#2493: query handlers can now declare `outputSchema` (the Zod shape of
// their actual return value). This validator is entirely opt-in and
// additive — a handler without `outputSchema`, or one whose declared shape
// this can't introspect (e.g. a z.union), leaves every check below a no-op,
// same "capability absent, no throw" policy as the input-schema checks in
// projection-list-screens.ts. Must run after validateQueryRefs (fw#2178):
// an unresolvable query QN is that validator's job to report — by the time
// this runs every `query` string here already resolves.

type ShapeLookup = Record<string, ZodType>;

function checkFieldExists(
  shape: ShapeLookup | undefined,
  field: string,
  buildMessage: () => string,
): void {
  // skip: capability absent (no introspectable shape) or field already present — nothing to validate
  if (shape === undefined || field in shape) return;
  throw new Error(buildMessage());
}

// Mirrors entity-list-screens.ts's "unlabeled unknown column" convention: a
// column with its own `label` is a virtual/computed cell drawn by a
// renderer, not a row field — exempt from the shape check.
function checkColumnField(
  rowShape: ShapeLookup | undefined,
  column: ListColumnSpec,
  buildMessage: (field: string) => string,
): void {
  const normalized = normalizeListColumn(column);
  // skip: labeled column is a virtual/computed cell drawn by a renderer, not a row field
  if (normalized.label !== undefined) return;
  checkFieldExists(rowShape, normalized.field, () => buildMessage(normalized.field));
}

// A paged handler (definePagedQueryHandler) whose outputSchema describes the
// row shape directly instead of the `{ rows, nextCursor, total? }` envelope
// would otherwise fail silently: getZodRowShape finds no "rows" key and every
// column check above just no-ops, so the author believes columns are checked
// when none are. Catches only the realistic mistake (envelope has no "rows"
// field at all) — an introspectable schema that isn't even a ZodObject is
// still "capability absent" per the module policy above.
function checkPagedHandlerOutputSchemaShape(
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
): void {
  for (const [qn, handler] of queryHandlers) {
    if (!isPagedQueryHandler(handler) || handler.outputSchema === undefined) continue;
    const shape = getZodObjectShape(handler.outputSchema);
    if (shape === undefined || "rows" in shape) continue;
    throw new Error(
      `Query handler "${qn}" is a paged handler (definePagedQueryHandler) but its outputSchema does not describe the paged envelope { rows: [...], nextCursor, total? } — it has no "rows" field. Did you pass the row schema instead of wrapping it in the envelope?`,
    );
  }
}

function checkProjectionListOutputColumns(
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
  featureName: string,
  screenId: string,
  screen: ProjectionListScreenDefinition,
): void {
  const rowShape = getZodRowShape(queryHandlers.get(screen.query)?.outputSchema);
  for (const column of screen.columns) {
    checkColumnField(
      rowShape,
      column,
      (field) =>
        `[Feature ${featureName}] Screen "${screenId}" (projectionList) column "${field}" is not present in query "${screen.query}"'s outputSchema — check for a typo, or add a "label" to mark it a virtual/computed column.`,
    );
  }
}

function checkEditLayoutOutputColumns(
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
  featureName: string,
  screenId: string,
  screenType: string,
  layout: EditLayout,
): void {
  for (const section of layout.sections) {
    if (section.kind !== "relatedList") continue;
    const rowShape = getZodRowShape(queryHandlers.get(section.query)?.outputSchema);
    for (const column of section.columns) {
      checkColumnField(
        rowShape,
        column,
        (field) =>
          `[Feature ${featureName}] Screen "${screenId}" (${screenType}) relatedList section "${section.title}" column "${field}" is not present in query "${section.query}"'s outputSchema — check for a typo, or add a "label" to mark it a virtual/computed column.`,
      );
    }
  }
}

function checkProjectionDetailOutputFields(
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
  featureName: string,
  screenId: string,
  screen: ProjectionDetailScreenDefinition,
): void {
  const recordShape = getZodObjectShape(queryHandlers.get(screen.query)?.outputSchema);
  const prefix = `[Feature ${featureName}] Screen "${screenId}" (projectionDetail)`;
  const checkHeaderField = (part: "title" | "subtitle" | "status", field: string): void => {
    checkFieldExists(
      recordShape,
      field,
      () =>
        `${prefix} header.${part} references field "${field}" which is not present in query "${screen.query}"'s outputSchema.`,
    );
  };
  if (screen.header !== undefined) {
    checkHeaderField("title", screen.header.title);
    if (screen.header.subtitle !== undefined) checkHeaderField("subtitle", screen.header.subtitle);
    if (screen.header.status !== undefined) checkHeaderField("status", screen.header.status);
  }
  for (const metric of screen.metrics ?? []) {
    checkFieldExists(
      recordShape,
      metric,
      () =>
        `${prefix} metrics references field "${metric}" which is not present in query "${screen.query}"'s outputSchema.`,
    );
  }
}

// Stat panels' query contract is a flat record (not the paged `{ rows }`
// envelope) — see DashboardStatPanel's doc in screen.ts — so this checks
// the handler's outputSchema shape directly, not its row shape.
function checkDashboardStatPanelFields(
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
  featureName: string,
  screenId: string,
  panel: DashboardStatPanel,
): void {
  const recordShape = getZodObjectShape(queryHandlers.get(panel.query)?.outputSchema);
  const prefix = `[Feature ${featureName}] Screen "${screenId}" (dashboard) panel "${panel.id}"`;
  const checkPanelField = (part: string, field: string | undefined): void => {
    // skip: this stat-panel field slot is optional and wasn't declared — nothing to validate
    if (field === undefined) return;
    checkFieldExists(
      recordShape,
      field,
      () =>
        `${prefix} ${part} references field "${field}" which is not present in query "${panel.query}"'s outputSchema.`,
    );
  };
  checkPanelField("valueField", panel.valueField);
  checkPanelField("subField", panel.subField);
  checkPanelField("toneField", panel.toneField);
  checkPanelField("deltaField", panel.deltaField);
  checkPanelField("deltaDirectionField", panel.deltaDirectionField);
  checkPanelField("deltaToneField", panel.deltaToneField);
}

function checkDashboardOutputFields(
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
  featureName: string,
  screenId: string,
  screen: DashboardScreenDefinition,
): void {
  for (const panel of screen.panels) {
    if (panel.kind === "stat") {
      checkDashboardStatPanelFields(queryHandlers, featureName, screenId, panel);
    } else if (panel.kind === "stat-group") {
      for (const stat of panel.stats) {
        checkDashboardStatPanelFields(queryHandlers, featureName, screenId, stat);
      }
    } else if (panel.kind === "list") {
      const rowShape = getZodRowShape(queryHandlers.get(panel.query)?.outputSchema);
      for (const column of panel.columns) {
        checkColumnField(
          rowShape,
          column,
          (field) =>
            `[Feature ${featureName}] Screen "${screenId}" (dashboard) panel "${panel.id}" column "${field}" is not present in query "${panel.query}"'s outputSchema — check for a typo, or add a "label" to mark it a virtual/computed column.`,
        );
      }
    }
    // chart/feed/progress-list/custom panels have a fixed query-result
    // contract with no author-declared field names to check.
  }
}

function checkScreenOutputColumns(
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
  featureName: string,
  screenId: string,
  screen: ScreenDefinition,
): void {
  if (screen.type === "projectionList") {
    checkProjectionListOutputColumns(queryHandlers, featureName, screenId, screen);
  } else if (screen.type === "projectionDetail") {
    checkProjectionDetailOutputFields(queryHandlers, featureName, screenId, screen);
    checkEditLayoutOutputColumns(
      queryHandlers,
      featureName,
      screenId,
      "projectionDetail",
      screen.layout,
    );
  } else if (
    screen.type === "entityEdit" ||
    screen.type === "actionForm" ||
    screen.type === "configEdit"
  ) {
    checkEditLayoutOutputColumns(queryHandlers, featureName, screenId, screen.type, screen.layout);
  } else if (screen.type === "dashboard") {
    checkDashboardOutputFields(queryHandlers, featureName, screenId, screen);
  }
}

export function validateQueryOutputColumns(features: readonly FeatureDefinition[]): void {
  const queryHandlers = buildQueryHandlerMap(features);
  checkPagedHandlerOutputSchemaShape(queryHandlers);
  for (const feature of features) {
    for (const [screenId, screen] of Object.entries(feature.screens)) {
      checkScreenOutputColumns(queryHandlers, feature.name, screenId, screen);
    }
  }
}
