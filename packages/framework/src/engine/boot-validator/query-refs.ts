import type {
  DashboardScreenDefinition,
  EditLayout,
  FeatureDefinition,
  QueryHandlerDef,
  ScreenDefinition,
} from "../types";
import { buildQueryHandlerMap } from "./projection-list-screens";

const NOT_REGISTERED_SUFFIX =
  "is not a registered query-handler. Check the QN spelling (expected " +
  '"<feature>:query:<short>") and that the handler is declared via r.queryHandler(...).';

function isNonEmptyQueryString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function checkQueryRef(
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
  query: string,
  buildPrefix: () => string,
): void {
  // skip: empty/non-string queries get their own message in screens.ts;
  // a registered query has nothing left to check.
  if (!isNonEmptyQueryString(query) || queryHandlers.has(query)) return;
  throw new Error(`${buildPrefix()} query "${query}" ${NOT_REGISTERED_SUFFIX}`);
}

// relatedList is currently only reachable on projectionDetail — screens.ts
// rejects it outright on entityEdit/actionForm/configEdit (fw#2166). Walking
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
  for (const panel of screen.panels) {
    if (panel.kind === "custom") continue;
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

function checkScreenQueryRefs(
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
  featureName: string,
  screenId: string,
  screen: ScreenDefinition,
): void {
  if (screen.type === "projectionList") {
    checkQueryRef(
      queryHandlers,
      screen.query,
      () => `[Feature ${featureName}] Screen "${screenId}" (projectionList)`,
    );
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
    screen.type === "configEdit"
  ) {
    checkEditLayoutQueryRefs(queryHandlers, featureName, screenId, screen.type, screen.layout);
  } else if (screen.type === "dashboard") {
    checkDashboardQueryRefs(queryHandlers, featureName, screenId, screen);
  }
}

export function validateQueryRefs(features: readonly FeatureDefinition[]): void {
  const queryHandlers = buildQueryHandlerMap(features);
  for (const feature of features) {
    for (const [screenId, screen] of Object.entries(feature.screens)) {
      checkScreenQueryRefs(queryHandlers, feature.name, screenId, screen);
    }
  }
}
