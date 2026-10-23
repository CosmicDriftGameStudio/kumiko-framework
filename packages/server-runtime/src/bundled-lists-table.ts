import { BUNDLED_LIST_FEATURE_NAMES } from "@cosmicdrift/kumiko-bundled-features/list-feature-names";
import {
  type BundledListsOptions,
  type EditSectionSpec,
  type FeatureDefinition,
  type ListColumnSpec,
  type ListTableOptions,
  normalizeListColumn,
  type ScreenDefinition,
  validateBundledListsOptions,
} from "@cosmicdrift/kumiko-framework/engine";

const BUNDLED_LIST_FEATURES: ReadonlySet<string> = new Set(BUNDLED_LIST_FEATURE_NAMES);

export function applyBundledListsTable(
  features: readonly FeatureDefinition[],
  options: BundledListsOptions | undefined,
): FeatureDefinition[] {
  if (options === undefined) return [...features];
  validateBundledListsOptions(options);
  return features.map((feature) =>
    BUNDLED_LIST_FEATURES.has(feature.name) ? withListTableDefaults(feature, options) : feature,
  );
}

function withListTableDefaults(
  feature: FeatureDefinition,
  options: BundledListsOptions,
): FeatureDefinition {
  return {
    ...feature,
    screens: Object.fromEntries(
      Object.entries(feature.screens).map(([id, screen]) => [
        id,
        withScreenTableDefaults(screen, options),
      ]),
    ),
  };
}

function withScreenTableDefaults(
  screen: ScreenDefinition,
  options: BundledListsOptions,
): ScreenDefinition {
  switch (screen.type) {
    case "entityList":
    case "projectionList": {
      const table: ListTableOptions = { ...options.table, ...screen.table };
      return { ...screen, table, columns: pinFirstColumn(screen.columns, table, options) };
    }
    case "projectionDetail":
      return {
        ...screen,
        layout: {
          ...screen.layout,
          sections: screen.layout.sections.map((section) =>
            withSectionTableDefaults(section, options),
          ),
        },
      };
    default:
      return screen;
  }
}

function withSectionTableDefaults(
  section: EditSectionSpec,
  options: BundledListsOptions,
): EditSectionSpec {
  if (section.kind !== "relatedList") return section;
  // export is only valid on entityList and projectionList
  const { export: _export, ...defaultsWithoutExport } = options.table;
  const table: ListTableOptions = { ...defaultsWithoutExport, ...section.table };
  return { ...section, table, columns: pinFirstColumn(section.columns, table, options) };
}

function pinFirstColumn(
  columns: readonly ListColumnSpec[],
  table: ListTableOptions,
  options: BundledListsOptions,
): readonly ListColumnSpec[] {
  if (options.pinFirstColumn !== true || table.pinning !== true) return columns;
  const normalized = columns.map(normalizeListColumn);
  if (normalized.some((column) => column.pinned !== undefined)) return columns;
  // A hidden column only appears via the column picker; pinning it would surprise the user.
  const firstVisible = normalized.findIndex((column) => column.hidden !== true);
  if (firstVisible === -1) return columns;
  return columns.map((column, index) =>
    index === firstVisible ? { ...normalizeListColumn(column), pinned: "left" } : column,
  );
}
