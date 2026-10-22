import { hasAccess } from "../../engine/access.ts";
import { toKebab } from "../../engine/qualified-name.ts";
import type {
  Registry,
  ScreenDefinition,
  ScreenFilter,
  SessionUser,
} from "../../engine/types/index.ts";
import { DEFAULT_EXPORT_MAX_ROWS } from "../../engine/types/screen.ts";
import { AccessDeniedError } from "../../errors/index.ts";
import { type ExportColumn, resolveExportColumns } from "./export-columns.ts";
import { exportRejection } from "./export-errors.ts";

const SCREEN_QN = /^[A-Za-z0-9_-]+:screen:[A-Za-z0-9_-]+$/;

export type ExportPlan = {
  readonly screenShortId: string;
  readonly queryType: string;
  readonly screenFilter: ScreenFilter | undefined;
  readonly columns: readonly ExportColumn[];
  readonly maxRows: number;
};

type ExportScreenRegistry = Pick<Registry, "getScreen" | "getScreenFeature" | "getEntity">;
type ExportableScreen = Extract<ScreenDefinition, { type: "entityList" | "projectionList" }>;

function findExportScreen(
  registry: ExportScreenRegistry,
  screenQn: string,
): { readonly registryQn: string; readonly screen: ExportableScreen } {
  // The client sends the feature name as authored (camelCase allowed); the registry keys are kebab.
  const registryQn = toKebab(screenQn);
  const screen = SCREEN_QN.test(screenQn) ? registry.getScreen(registryQn) : undefined;
  if (screen === undefined || (screen.type !== "entityList" && screen.type !== "projectionList")) {
    throw exportRejection("export_unknown_screen", "screen");
  }
  return { registryQn, screen };
}

export function resolveExportPlan(
  registry: ExportScreenRegistry,
  screenQn: string,
  requestedColumns: readonly string[],
  user: Pick<SessionUser, "roles">,
): ExportPlan {
  const { registryQn, screen } = findExportScreen(registry, screenQn);
  if (screen.table?.export?.xlsx !== true) throw exportRejection("export_not_enabled", "screen");
  if (screen.access !== undefined && !hasAccess(user, screen.access)) {
    throw new AccessDeniedError({ details: { screen: screenQn } });
  }
  // Label keys use the feature name as authored, query types the kebab form.
  const featureName = registry.getScreenFeature(registryQn) ?? "";
  const screenShortId = registryQn.split(":")[2] ?? "";
  const maxRows = screen.table.export.maxRows ?? DEFAULT_EXPORT_MAX_ROWS;
  if (screen.type === "projectionList") {
    return {
      screenShortId,
      queryType: screen.query,
      screenFilter: screen.filter,
      columns: resolveExportColumns(
        { featureName, columns: screen.columns, entity: undefined, entityName: undefined, user },
        requestedColumns,
      ),
      maxRows,
    };
  }
  const entity = registry.getEntity(screen.entity);
  if (entity === undefined) throw exportRejection("export_unknown_screen", "screen");
  return {
    screenShortId,
    queryType: `${toKebab(featureName)}:query:${toKebab(screen.entity)}:list`,
    screenFilter: screen.filter,
    columns: resolveExportColumns(
      { featureName, columns: screen.columns, entity, entityName: screen.entity, user },
      requestedColumns,
    ),
    maxRows,
  };
}
