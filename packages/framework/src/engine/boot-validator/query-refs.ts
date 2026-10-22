import { isFieldsEditSection, normalizeEditField, sectionFieldSpecs } from "../screen-helpers.ts";
import type {
  DashboardScreenDefinition,
  EditLayout,
  FeatureDefinition,
  FieldDefinition,
  QueryHandlerDef,
  ScreenDefinition,
} from "../types/index.ts";
import { buildQueryHandlerMap } from "./projection-list-screens.ts";

const NOT_REGISTERED_SUFFIX =
  "is not a registered query-handler. Check the QN spelling (expected " +
  '"<feature>:query:<short>") and that the handler is declared via r.queryHandler(...).';

function isNonEmptyQueryString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function checkQueryRef(
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
  query: string,
  buildPrefix: () => string,
): void {
  // skip: empty/non-string queries get their own message in screens.ts;
  // a registered query has nothing left to check.
  if (!isNonEmptyQueryString(query) || queryHandlers.has(query)) return;
  throw new Error(`${buildPrefix()} query "${query}" ${NOT_REGISTERED_SUFFIX}`);
}

// visibleWhen queries are run with an empty payload by the client gate, so a query
// that requires input would fail on every call and the screen/panel would stay
// unavailable with no hint.
function checkVisibleWhenQueryRef(
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
  query: string,
  buildPrefix: () => string,
): void {
  checkQueryRef(queryHandlers, query, buildPrefix);
  const handler = queryHandlers.get(query);
  // skip: nothing to check for an unknown handler (checkQueryRef already threw) or an input-free query
  if (handler === undefined || handler.schema.safeParse({}).success) return;
  throw new Error(
    `${buildPrefix()} query "${query}" requires input; visibleWhen queries run with an empty payload. ` +
      "Make the query's input fields optional or use a query without required input.",
  );
}

// relatedList is currently only reachable on projectionDetail — screens.ts
// rejects it outright on entityEdit/actionForm/configEdit. Walking
// the shared EditLayout uniformly here (instead of excluding those three
// types) keeps this collector correct if that restriction is ever lifted.
function checkEditLayoutQueryRefs(
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
  featureName: string,
  screenId: string,
  screenType: string,
  layout: EditLayout,
): void {
  for (const section of layout.sections) {
    if (isFieldsEditSection(section)) {
      for (const fieldSpec of sectionFieldSpecs(section)) {
        const { field, fillAction } = normalizeEditField(fieldSpec);
        if (fillAction === undefined) continue;
        checkQueryRef(
          queryHandlers,
          fillAction.query,
          () =>
            `[Feature ${featureName}] Screen "${screenId}" (${screenType}) field "${field}" fillAction`,
        );
      }
    }
    if (section.kind !== "relatedList") continue;
    checkQueryRef(
      queryHandlers,
      section.query,
      () =>
        `[Feature ${featureName}] Screen "${screenId}" (${screenType}) relatedList section "${section.title}"`,
    );
  }
}

function checkDashboardQueryRefs(
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
  featureName: string,
  screenId: string,
  screen: DashboardScreenDefinition,
): void {
  if (screen.record?.query !== undefined) {
    checkQueryRef(
      queryHandlers,
      screen.record.query,
      () => `[Feature ${featureName}] Screen "${screenId}" (dashboard) record`,
    );
  }
  for (const panel of screen.panels) {
    if (panel.kind === "custom") continue;
    if (panel.visibleWhen !== undefined) {
      checkVisibleWhenQueryRef(
        queryHandlers,
        panel.visibleWhen.query,
        () =>
          `[Feature ${featureName}] Screen "${screenId}" (dashboard) ${panel.kind === "screen" ? "screen-panel" : "panel"} "${panel.id}" visibleWhen`,
      );
    }
    if (panel.kind === "screen" || panel.kind === "text") continue;
    if (panel.kind === "stat-group") {
      for (const stat of panel.stats) {
        checkQueryRef(
          queryHandlers,
          stat.query,
          () =>
            `[Feature ${featureName}] Screen "${screenId}" (dashboard) stat-group "${panel.id}" child "${stat.id}"`,
        );
      }
      continue;
    }
    checkQueryRef(
      queryHandlers,
      panel.query,
      () => `[Feature ${featureName}] Screen "${screenId}" (dashboard) panel "${panel.id}"`,
    );
  }
  if (screen.filter?.optionsQuery !== undefined) {
    checkQueryRef(
      queryHandlers,
      screen.filter.optionsQuery,
      () =>
        `[Feature ${featureName}] Screen "${screenId}" (dashboard) filter "${screen.filter?.id}"`,
    );
  }
}

function checkFormFieldQueryRefs(
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
  featureName: string,
  screenId: string,
  screenType: string,
  fields: Readonly<Record<string, FieldDefinition>>,
): void {
  for (const [fieldName, field] of Object.entries(fields)) {
    if (field.type === "multiSelect" && field.optionsAvailabilityQuery !== undefined) {
      checkQueryRef(
        queryHandlers,
        field.optionsAvailabilityQuery,
        () =>
          `[Feature ${featureName}] Screen "${screenId}" (${screenType}) multiSelect field "${fieldName}" optionsAvailabilityQuery`,
      );
    }
    if (field.type !== "select") continue;
    if (field.optionsQuery !== undefined) {
      checkQueryRef(
        queryHandlers,
        field.optionsQuery,
        () =>
          `[Feature ${featureName}] Screen "${screenId}" (${screenType}) select field "${fieldName}" optionsQuery`,
      );
    }
    if (field.optionsAvailabilityQuery !== undefined) {
      checkQueryRef(
        queryHandlers,
        field.optionsAvailabilityQuery,
        () =>
          `[Feature ${featureName}] Screen "${screenId}" (${screenType}) select field "${fieldName}" optionsAvailabilityQuery`,
      );
    }
  }
}

type EditFormScreenDefinition = Extract<
  ScreenDefinition,
  { readonly type: "entityEdit" | "actionForm" | "configEdit" | "secretMint" }
>;

function checkEditFormScreenQueryRefs(
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
  featureName: string,
  screenId: string,
  screen: EditFormScreenDefinition,
): void {
  checkEditLayoutQueryRefs(queryHandlers, featureName, screenId, screen.type, screen.layout);
  if (screen.type === "actionForm" && screen.load !== undefined) {
    checkQueryRef(
      queryHandlers,
      screen.load.query,
      () => `[Feature ${featureName}] Screen "${screenId}" (actionForm) load`,
    );
    // A singleton load sends no id, so a query that requires input would fail on every open.
    const loadHandler = queryHandlers.get(screen.load.query);
    if (
      screen.load.singleton === true &&
      loadHandler !== undefined &&
      !loadHandler.schema.safeParse({}).success
    ) {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (actionForm) load.singleton query "${screen.load.query}" ` +
          "requires input; a singleton load runs with an empty payload. Make the query's input fields optional.",
      );
    }
  }
  if (screen.type !== "entityEdit") {
    checkFormFieldQueryRefs(queryHandlers, featureName, screenId, screen.type, screen.fields);
  }
  if (screen.type === "secretMint" && screen.confirm !== undefined) {
    checkFormFieldQueryRefs(
      queryHandlers,
      featureName,
      screenId,
      "secretMint confirm",
      screen.confirm.fields,
    );
  }
}

function checkScreenQueryRefs(
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
  featureName: string,
  screenId: string,
  screen: ScreenDefinition,
): void {
  if (screen.visibleWhen !== undefined) {
    checkVisibleWhenQueryRef(
      queryHandlers,
      screen.visibleWhen.query,
      () => `[Feature ${featureName}] Screen "${screenId}" (${screen.type}) visibleWhen`,
    );
  }
  if (screen.type === "projectionList") {
    checkQueryRef(
      queryHandlers,
      screen.query,
      () => `[Feature ${featureName}] Screen "${screenId}" (projectionList)`,
    );
  } else if (screen.type === "entityList") {
    if (screen.expandableRow !== undefined) {
      checkQueryRef(
        queryHandlers,
        screen.expandableRow.query,
        () =>
          `[Feature ${featureName}] Screen "${screenId}" (entityList) expandableRow "${screen.expandableRow?.title}"`,
      );
    }
  } else if (screen.type === "projectionDetail") {
    checkQueryRef(
      queryHandlers,
      screen.query,
      () => `[Feature ${featureName}] Screen "${screenId}" (projectionDetail)`,
    );
    checkEditLayoutQueryRefs(
      queryHandlers,
      featureName,
      screenId,
      "projectionDetail",
      screen.layout,
    );
  } else if (
    screen.type === "entityEdit" ||
    screen.type === "actionForm" ||
    screen.type === "configEdit" ||
    screen.type === "secretMint"
  ) {
    checkEditFormScreenQueryRefs(queryHandlers, featureName, screenId, screen);
  } else if (screen.type === "dashboard") {
    checkDashboardQueryRefs(queryHandlers, featureName, screenId, screen);
  }
}

export function validateQueryRefs(features: readonly FeatureDefinition[]): void {
  const queryHandlers = buildQueryHandlerMap(features);
  for (const feature of features) {
    for (const [keyName, keyDef] of Object.entries(feature.configKeys)) {
      if (keyDef.optionsQuery === undefined) continue;
      checkQueryRef(
        queryHandlers,
        keyDef.optionsQuery,
        () => `[Feature ${feature.name}] Config key "${keyName}" optionsQuery`,
      );
    }
    for (const [screenId, screen] of Object.entries(feature.screens)) {
      checkScreenQueryRefs(queryHandlers, feature.name, screenId, screen);
    }
  }
}
