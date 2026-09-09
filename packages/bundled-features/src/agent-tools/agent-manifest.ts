import type {
  AccessRule,
  EntityDefinition,
  FeatureDefinition,
  FieldDefinition,
  NavDefinition,
  QueryHandlerDef,
  ScreenDefinition,
  TranslationKeys,
  WorkspaceDefinition,
  WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  hasAccess,
  isAgentVisibleScreen,
  resolveAgentExposure,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import type {
  AgentManifest,
  AgentManifestEntity,
  AgentManifestFeature,
  AgentManifestField,
  AgentManifestHandler,
  AgentManifestNav,
  AgentManifestOptions,
  AgentManifestScreen,
  AgentManifestWorkspace,
  RegistryManifestView,
} from "./types";

/** Translation keys carry a feature prefix the manifest can't reconstruct
 *  (`showcase:entity:item:field:title`), so match on the suffix instead. */
function labelsForSuffix(
  translations: TranslationKeys,
  suffix: string,
): Readonly<Record<string, string>> {
  for (const [key, labels] of Object.entries(translations)) {
    if (key === suffix || key.endsWith(suffix)) return labels;
  }
  return {};
}

/** Nav/screen/workspace gating is opt-in: no rule means visible to everyone
 *  (NavDefinition.access). Handlers are the opposite — `hasAccess` is
 *  default-deny there. */
function uiVisible(access: AccessRule | undefined, roles: readonly string[]): boolean {
  return access === undefined || hasAccess({ roles }, access);
}

// localeCompare depends on the runtime locale and ICU punctuation rules; qualified
// names contain `:`, so compare by code point instead for deterministic ordering.
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function dedupeSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareIds);
}

// Map iteration follows the feature-mount order; the manifest must not depend on it.
function sortedByKey<T>(items: readonly T[], key: (item: T) => string): readonly T[] {
  return [...items].sort((a, b) => compareIds(key(a), key(b)));
}

function visibleWorkspaceIds(
  workspaceIds: readonly string[] | undefined,
  workspaces: ReadonlyMap<string, WorkspaceDefinition>,
  roles: readonly string[],
): readonly string[] {
  if (!workspaceIds) return [];
  return dedupeSorted(
    workspaceIds.filter((id) => {
      const workspace = workspaces.get(id);
      return workspace !== undefined && uiVisible(workspace.access, roles);
    }),
  );
}

function isFilterableField(field: FieldDefinition): boolean {
  return "filterable" in field && field.filterable === true;
}

function isPiiField(field: FieldDefinition): boolean {
  return "pii" in field && field.pii === true;
}

function buildField(
  entityName: string,
  fieldName: string,
  field: FieldDefinition,
  translations: TranslationKeys,
  searchableFields: ReadonlySet<string>,
): AgentManifestField {
  const options =
    field.type === "select" || field.type === "multiSelect" ? field.options : undefined;
  const references = field.type === "reference" ? field.entity : undefined;

  return {
    name: fieldName,
    type: field.type,
    labels: labelsForSuffix(translations, `:entity:${entityName}:field:${fieldName}`),
    ...(field.description !== undefined && { description: field.description }),
    ...(options !== undefined && { options }),
    ...(references !== undefined && { references }),
    ...(searchableFields.has(fieldName) && { searchable: true as const }),
    ...(isFilterableField(field) && { filterable: true as const }),
    ...(isPiiField(field) && { pii: true as const }),
  };
}

/** Entity schemas are emitted unfiltered by design: roles gate handlers, screens,
 *  navs and workspaces, while the handler pipeline gates the values themselves.
 *  The manifest describes shape, never data. */
function buildEntities(
  entities: ReadonlyMap<string, EntityDefinition>,
  translations: TranslationKeys,
  getSearchableFields: (entityName: string) => readonly string[],
): readonly AgentManifestEntity[] {
  const result: AgentManifestEntity[] = [];
  for (const [entityName, entity] of entities) {
    const searchableFields = new Set(getSearchableFields(entityName));
    const fields = Object.entries(entity.fields).map(([fieldName, field]) =>
      buildField(entityName, fieldName, field, translations, searchableFields),
    );
    result.push({
      name: entityName,
      labels: labelsForSuffix(translations, `:entity:${entityName}`),
      ...(entity.description !== undefined && { description: entity.description }),
      fields,
    });
  }
  return result;
}

function buildFeatures(
  features: ReadonlyMap<string, FeatureDefinition>,
): readonly AgentManifestFeature[] {
  const result: AgentManifestFeature[] = [];
  for (const [, feature] of features) {
    result.push({
      name: feature.name,
      ...(feature.description !== undefined && { description: feature.description }),
      ...(feature.uiHints?.displayLabel !== undefined && {
        displayLabel: feature.uiHints.displayLabel,
      }),
    });
  }
  return result;
}

function buildHandlerEntry(
  qn: string,
  kind: "query" | "write",
  def: QueryHandlerDef | WriteHandlerDef,
  roles: readonly string[],
  getHandlerEntity: (qualifiedHandler: string) => string | undefined,
  denyQns: ReadonlySet<string>,
): AgentManifestHandler | undefined {
  if (denyQns.has(qn)) return undefined;
  const exposure = resolveAgentExposure(def, kind);
  if (!exposure.expose) return undefined;
  if (!hasAccess({ roles }, def.access)) return undefined;

  // `agent.expose: true` without a `description` still opts in — the author
  // asked for exposure explicitly, there's just nothing to show as prose.
  const description = def.description ?? "";

  let inputSchema: Readonly<Record<string, unknown>>;
  try {
    // A handler whose schema can't be expressed as JSON Schema (transforms,
    // z.instanceof, ...) is unusable for an agent tool call — leave it out
    // rather than ship a broken tool.
    inputSchema = z.toJSONSchema(def.schema, { io: "input" }) as Readonly<Record<string, unknown>>;
  } catch {
    return undefined;
  }

  const entity = getHandlerEntity(qn);
  return {
    qn,
    kind,
    description,
    risk: exposure.risk,
    inputSchema,
    ...(entity !== undefined && { entity }),
  };
}

function buildHandlers(
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
  writeHandlers: ReadonlyMap<string, WriteHandlerDef>,
  roles: readonly string[],
  getHandlerEntity: (qualifiedHandler: string) => string | undefined,
  denyQns: ReadonlySet<string>,
): readonly AgentManifestHandler[] {
  const result: AgentManifestHandler[] = [];
  for (const [qn, def] of queryHandlers) {
    const entry = buildHandlerEntry(qn, "query", def, roles, getHandlerEntity, denyQns);
    if (entry) result.push(entry);
  }
  for (const [qn, def] of writeHandlers) {
    const entry = buildHandlerEntry(qn, "write", def, roles, getHandlerEntity, denyQns);
    if (entry) result.push(entry);
  }
  return result;
}

function buildNavs(
  navs: ReadonlyMap<string, NavDefinition>,
  workspaces: ReadonlyMap<string, WorkspaceDefinition>,
  translations: TranslationKeys,
  roles: readonly string[],
  screens: ReadonlyMap<string, ScreenDefinition>,
): readonly AgentManifestNav[] {
  const result: AgentManifestNav[] = [];
  for (const [, nav] of navs) {
    if (!uiVisible(nav.access, roles)) continue;
    // A nav pointing at an opted-out screen would leak its id and label back
    // into the manifest the screen was just removed from.
    const target = nav.screen !== undefined ? screens.get(nav.screen) : undefined;
    if (target !== undefined && !isAgentVisibleScreen(target)) continue;
    const visibleWorkspaces = visibleWorkspaceIds(nav.workspaces, workspaces, roles);
    const hasWorkspaces = nav.workspaces !== undefined && nav.workspaces.length > 0;
    if (hasWorkspaces && visibleWorkspaces.length === 0) continue;

    result.push({
      id: nav.id,
      labels: translations[nav.label] ?? {},
      ...(nav.screen !== undefined && { screen: nav.screen }),
      ...(nav.parent !== undefined && { parent: nav.parent }),
      workspaces: visibleWorkspaces,
    });
  }
  return result;
}

function lastSegment(qualifiedId: string): string {
  const idx = qualifiedId.lastIndexOf(":");
  return idx === -1 ? qualifiedId : qualifiedId.slice(idx + 1);
}

function buildScreens(
  screens: ReadonlyMap<string, ScreenDefinition>,
  navs: ReadonlyMap<string, NavDefinition>,
  workspaces: ReadonlyMap<string, WorkspaceDefinition>,
  translations: TranslationKeys,
  roles: readonly string[],
): readonly AgentManifestScreen[] {
  const allNavs = [...navs.values()];
  const result: AgentManifestScreen[] = [];

  for (const [, screen] of screens) {
    // An opted-out screen must not reach the manifest at all — the tool catalog
    // builds `navigate`'s screen-id enum straight from `manifest.screens`.
    if (!isAgentVisibleScreen(screen)) continue;
    const matchingNavs = allNavs.filter((nav) => nav.screen === screen.id);
    const accessibleNavs = matchingNavs.filter((nav) => uiVisible(nav.access, roles));

    // A screen with no nav pointing at it is a detail view, reached only via
    // navigation from a list row — never hidden by nav/workspace gating.
    const reachable =
      matchingNavs.length === 0 ||
      accessibleNavs.some((nav) => {
        if (!nav.workspaces || nav.workspaces.length === 0) return true;
        return visibleWorkspaceIds(nav.workspaces, workspaces, roles).length > 0;
      });
    if (!uiVisible(screen.access, roles) || !reachable) continue;

    const shortId = lastSegment(screen.id);
    const screenWorkspaces = dedupeSorted(
      accessibleNavs.flatMap((nav) => visibleWorkspaceIds(nav.workspaces, workspaces, roles)),
    );

    result.push({
      id: screen.id,
      type: screen.type,
      titles: labelsForSuffix(translations, `screen:${shortId}.title`),
      ...(screen.description !== undefined && { description: screen.description }),
      ...("entity" in screen && screen.entity !== undefined && { entity: screen.entity }),
      // A detail screen takes the row id; everything else is parameterless.
      params: screen.detailFor !== undefined ? ["id"] : [],
      workspaces: screenWorkspaces,
      ...(screen.detailFor !== undefined && { detailFor: screen.detailFor }),
      ...("handler" in screen && typeof screen.handler === "string" && { handler: screen.handler }),
    });
  }
  return result;
}

function buildWorkspaces(
  workspaces: ReadonlyMap<string, WorkspaceDefinition>,
  translations: TranslationKeys,
  roles: readonly string[],
): readonly AgentManifestWorkspace[] {
  const result: AgentManifestWorkspace[] = [];
  for (const [, workspace] of workspaces) {
    if (!uiVisible(workspace.access, roles)) continue;
    result.push({
      id: workspace.id,
      labels: translations[workspace.label] ?? {},
      ...(workspace.default === true && { default: true as const }),
    });
  }
  return result;
}

/** Registry snapshot → AI-agent manifest. Pure, deterministic, no I/O — mirrors
 *  `buildToolCatalog`'s contract, just describing the app's shape instead of
 *  generating callable tools from it. */
export function buildAgentManifest(
  registry: RegistryManifestView,
  options: AgentManifestOptions,
): AgentManifest {
  const translations = registry.getAllTranslations();
  const workspaceMap = registry.getAllWorkspaces();
  const navMap = registry.getAllNavs();
  const { roles } = options;

  const features = buildFeatures(registry.features);
  const entities = buildEntities(registry.getAllEntities(), translations, (name) =>
    registry.getSearchableFields(name),
  );
  const handlers = buildHandlers(
    registry.getAllQueryHandlers(),
    registry.getAllWriteHandlers(),
    roles,
    (qn) => registry.getHandlerEntity(qn),
    new Set(options.denyQns ?? []),
  );
  const screenMap = registry.getAllScreens();
  const navs = buildNavs(navMap, workspaceMap, translations, roles, screenMap);
  const screens = buildScreens(screenMap, navMap, workspaceMap, translations, roles);
  const workspaces = buildWorkspaces(workspaceMap, translations, roles);

  return {
    builtForRoles: [...roles],
    features: sortedByKey(features, (f) => f.name),
    entities: sortedByKey(entities, (e) => e.name),
    handlers: sortedByKey(handlers, (h) => h.qn),
    screens: sortedByKey(screens, (s) => s.id),
    navs: sortedByKey(navs, (n) => n.id),
    workspaces: sortedByKey(workspaces, (w) => w.id),
    tenantSettings: {
      locale: options.locale,
      ...(options.currency && { currency: options.currency }),
    },
  };
}
