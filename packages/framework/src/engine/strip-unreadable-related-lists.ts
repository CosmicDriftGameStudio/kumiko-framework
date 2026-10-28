import type { AccessRule } from "@cosmicdrift/kumiko-types/handlers";
import type { AppSchema, FeatureSchema } from "../ui-types/app-schema.ts";
import { hasAccess } from "./access.ts";
import type {
  EditLayout,
  EditSectionSpec,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
  MetricSpec,
  ProjectionDetailScreenDefinition,
  ScreenDefinition,
} from "./types/screen.ts";

export type QueryAccessLookup = (queryQn: string) => AccessRule | undefined;

// A relatedList section runs its own query; a caller whose roles cannot execute that query would
// see a tab that only ever errors, so the section is removed from the role's schema.
export function stripUnreadableRelatedLists(
  schema: AppSchema,
  roles: readonly string[],
  queryAccess: QueryAccessLookup,
): AppSchema {
  const canRun = (queryQn: string): boolean => hasAccess({ roles }, queryAccess(queryQn));
  let changed = false;
  const features = schema.features.map((feature) => {
    const next = stripFeature(feature, canRun);
    if (next !== feature) changed = true;
    return next;
  });
  return changed ? { ...schema, features } : schema;
}

function stripFeature(feature: FeatureSchema, canRun: (qn: string) => boolean): FeatureSchema {
  let changed = false;
  const screens = feature.screens.map((screen) => {
    const next = stripScreen(screen, canRun);
    if (next !== screen) changed = true;
    return next;
  });
  return changed ? { ...feature, screens } : feature;
}

function stripScreen(screen: ScreenDefinition, canRun: (qn: string) => boolean): ScreenDefinition {
  switch (screen.type) {
    case "projectionDetail":
      return stripProjectionDetail(screen, canRun);
    case "entityEdit":
      return stripEntityEdit(screen, canRun);
    case "entityList":
      return stripExpandableRow(screen, canRun);
    default:
      return screen;
  }
}

function stripExpandableRow(
  screen: EntityListScreenDefinition,
  canRun: (qn: string) => boolean,
): ScreenDefinition {
  if (screen.expandableRow === undefined || canRun(screen.expandableRow.query)) return screen;
  const { expandableRow: _removed, ...rest } = screen;
  return rest;
}

function stripEntityEdit(
  screen: EntityEditScreenDefinition,
  canRun: (qn: string) => boolean,
): ScreenDefinition {
  const { layout } = stripLayout(screen.layout, canRun);
  return layout === screen.layout ? screen : { ...screen, layout };
}

function stripProjectionDetail(
  screen: ProjectionDetailScreenDefinition,
  canRun: (qn: string) => boolean,
): ScreenDefinition {
  const { layout, removedIds } = stripLayout(screen.layout, canRun);
  if (layout === screen.layout) return screen;
  const metrics = screen.metrics?.map((metric) => stripDeadTabNavigate(metric, removedIds));
  return { ...screen, layout, ...(metrics !== undefined && { metrics }) };
}

function stripLayout(
  layout: EditLayout,
  canRun: (qn: string) => boolean,
): { readonly layout: EditLayout; readonly removedIds: readonly string[] } {
  const removedIds: string[] = [];
  const sections = layout.sections.filter((section) => {
    if (!isUnrunnableRelatedList(section, canRun)) return true;
    if (section.id !== undefined) removedIds.push(section.id);
    return false;
  });
  if (sections.length === layout.sections.length) return { layout, removedIds };
  return { layout: { ...layout, sections }, removedIds };
}

function isUnrunnableRelatedList(
  section: EditSectionSpec,
  canRun: (qn: string) => boolean,
): boolean {
  return section.kind === "relatedList" && !canRun(section.query);
}

function stripDeadTabNavigate(metric: MetricSpec, removedTabIds: readonly string[]): MetricSpec {
  const navigate = metric.navigate;
  const pointsAtRemovedTab =
    navigate?.tab !== undefined &&
    navigate.screen === undefined &&
    navigate.entity === undefined &&
    removedTabIds.includes(navigate.tab);
  if (!pointsAtRemovedTab) return metric;
  const { navigate: _removed, ...rest } = metric;
  return rest;
}
