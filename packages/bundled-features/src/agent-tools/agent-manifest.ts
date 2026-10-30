import type {
  AccessRule,
  EntityDefinition,
  FeatureDefinition,
  FieldDefinition,
  NavDefinition,
  QueryHandlerDef,
  ScreenDefinition,
  TranslationEntry,
  TranslationKeys,
  WorkspaceDefinition,
  WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  hasAccess,
  isAgentVisibleScreen,
  resolveAgentExposure,
  SYSTEM_ONLY_JSON_SCHEMA_KEY,
} from "@cosmicdrift/kumiko-framework/engine";
import { translationValueOtherText } from "@cosmicdrift/kumiko-framework/ui-types";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import * as z from "zod";
import { recordManifestDenyQns } from "./manifest-deny-qns.ts";
import { isExplicitlyAgentHidden } from "./tool-catalog.ts";
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
} from "./types.ts";

const FALLBACK_LOCALE = "en";

/** Requested locale, then English, then the first remaining locale in code-point
 *  order; `undefined` when the entry has no text at all (the key is then omitted). */
function pickLabel(labels: Readonly<Record<string, string>>, locale: string): string | undefined {
  const nonEmpty = (value: string | undefined): string | undefined =>
    value !== undefined && value !== "" ? value : undefined;
  const firstLocale = Object.keys(labels)
    .sort(compareIds)
    .find((key) => nonEmpty(labels[key]));
  return (
    nonEmpty(labels[locale]) ??
    nonEmpty(labels[FALLBACK_LOCALE]) ??
    (firstLocale !== undefined ? labels[firstLocale] : undefined)
  );
}

function labelProp(
  labels: Readonly<Record<string, string>>,
  locale: string,
): { readonly label?: string } {
  const label = pickLabel(labels, locale);
  return label === undefined ? {} : { label };
}

/** The manifest surfaces one string per locale — a plural entry reads as its
 *  CLDR `other` form since the manifest has no `count` to select a category. */
function entryAsLabels(entry: TranslationEntry): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(entry).map(([locale, value]) => [locale, translationValueOtherText(value)]),
  );
}

const labelsIndexByTranslations = new WeakMap<
  TranslationKeys,
  Map<string, Readonly<Record<string, string>>>
>();

/** Every tail starting at a key boundary (`:` or `.`, with and without the
 *  separator) maps to the labels of the first key that ends with it. */
function buildSuffixIndex(
  translations: TranslationKeys,
): Map<string, Readonly<Record<string, string>>> {
  const index = new Map<string, Readonly<Record<string, string>>>();
  for (const [key, entry] of Object.entries(translations)) {
    const labels = entryAsLabels(entry);
    const addTail = (start: number): void => {
      const tail = key.slice(start);
      if (!index.has(tail)) index.set(tail, labels);
    };
    addTail(0);
    for (let position = 0; position < key.length; position++) {
      if (key[position] === ":" || key[position] === ".") {
        addTail(position);
        addTail(position + 1);
      }
    }
  }
  return index;
}

/** Translation keys carry a feature prefix the manifest can't reconstruct
 *  (`showcase:entity:item:field:title`), so match on the suffix instead. The
 *  suffix must start at a `:` or `.` boundary of the key. */
function labelsForSuffix(
  translations: TranslationKeys,
  suffix: string,
): Readonly<Record<string, string>> {
  let index = labelsIndexByTranslations.get(translations);
  if (index === undefined) {
    index = buildSuffixIndex(translations);
    labelsIndexByTranslations.set(translations, index);
  }
  return index.get(suffix) ?? {};
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
  locale: string,
): AgentManifestField {
  const options =
    field.type === "select" || field.type === "multiSelect" ? field.options : undefined;
  const references = field.type === "reference" ? field.entity : undefined;

  return {
    name: fieldName,
    type: field.type,
    ...labelProp(labelsForSuffix(translations, `:entity:${entityName}:field:${fieldName}`), locale),
    ...(field.description !== undefined && { description: field.description }),
    ...(options !== undefined && { options }),
    ...(references !== undefined && { references }),
    ...(searchableFields.has(fieldName) && { searchable: true as const }),
    ...(isFilterableField(field) && { filterable: true as const }),
    ...(isPiiField(field) && { pii: true as const }),
  };
}

/** Shape, never data. Only entities the role reaches are emitted: the manifest is
 *  prompt payload, so every extra schema costs tokens on each turn. */
function buildEntities(
  entities: ReadonlyMap<string, EntityDefinition>,
  translations: TranslationKeys,
  getSearchableFields: (entityName: string) => readonly string[],
  visibleEntityNames: ReadonlySet<string>,
  locale: string,
): readonly AgentManifestEntity[] {
  const result: AgentManifestEntity[] = [];
  for (const [entityName, entity] of entities) {
    if (!visibleEntityNames.has(entityName)) continue;
    const searchableFields = new Set(getSearchableFields(entityName));
    const fields = Object.entries(entity.fields).map(([fieldName, field]) =>
      buildField(entityName, fieldName, field, translations, searchableFields, locale),
    );
    result.push({
      name: entityName,
      ...labelProp(labelsForSuffix(translations, `:entity:${entityName}`), locale),
      ...(entity.description !== undefined && { description: entity.description }),
      fields,
    });
  }
  return result;
}

function buildFeatures(
  features: ReadonlyMap<string, FeatureDefinition>,
  visibleFeatureNames: ReadonlySet<string>,
): readonly AgentManifestFeature[] {
  const result: AgentManifestFeature[] = [];
  for (const [, feature] of features) {
    if (!visibleFeatureNames.has(feature.name)) continue;
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

// Agent dispatch never runs as a system identity, so properties the engine only
// honors for system callers would be silently dropped — hide them from the tool.
export function systemOnlyPropertyNames(jsonSchema: Record<string, unknown>): readonly string[] {
  const properties = jsonSchema["properties"];
  if (typeof properties !== "object" || properties === null) return [];
  return Object.entries(properties)
    .filter(
      ([, property]) => isPlainObject(property) && property[SYSTEM_ONLY_JSON_SCHEMA_KEY] === true,
    )
    .map(([name]) => name);
}

function withoutSystemOnlyProperties(
  jsonSchema: Record<string, unknown>,
): Readonly<Record<string, unknown>> {
  const properties = jsonSchema["properties"];
  if (typeof properties !== "object" || properties === null) return jsonSchema;
  const hidden = systemOnlyPropertyNames(jsonSchema);
  if (hidden.length === 0) return jsonSchema;
  const required = jsonSchema["required"];
  return {
    ...jsonSchema,
    properties: Object.fromEntries(
      Object.entries(properties).filter(([name]) => !hidden.includes(name)),
    ),
    ...(Array.isArray(required) && { required: required.filter((name) => !hidden.includes(name)) }),
  };
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
  const description =
    def.description !== undefined && def.description !== "" ? def.description : undefined;

  let inputSchema: Readonly<Record<string, unknown>>;
  try {
    // A handler whose schema can't be expressed as JSON Schema (transforms,
    // z.instanceof, ...) is unusable for an agent tool call — leave it out
    // rather than ship a broken tool.
    inputSchema = withoutSystemOnlyProperties(z.toJSONSchema(def.schema, { io: "input" }));
  } catch {
    return undefined;
  }

  const entity = getHandlerEntity(qn);
  const excludedFields = "excludedFields" in def ? def.excludedFields : undefined;
  return {
    qn,
    kind,
    ...(description !== undefined && { description }),
    risk: exposure.risk,
    inputSchema,
    ...(entity !== undefined && { entity }),
    ...(excludedFields !== undefined && { excludedFields }),
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

// A typo or a QN renamed by a framework update would otherwise deny nothing
// and leave the handler exposed without anyone noticing.
function assertDenyQnsExist(denyQns: readonly string[], registry: RegistryManifestView): void {
  const queryHandlers = registry.getAllQueryHandlers();
  const writeHandlers = registry.getAllWriteHandlers();
  const unknown = denyQns.filter((qn) => !queryHandlers.has(qn) && !writeHandlers.has(qn));
  if (unknown.length > 0) {
    throw new Error(`agent denyQns names handlers that are not registered: ${unknown.join(", ")}`);
  }
}

function buildNavs(
  navs: ReadonlyMap<string, NavDefinition>,
  workspaces: ReadonlyMap<string, WorkspaceDefinition>,
  translations: TranslationKeys,
  roles: readonly string[],
  screens: ReadonlyMap<string, ScreenDefinition>,
  locale: string,
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
      ...labelProp(entryAsLabels(translations[nav.label] ?? {}), locale),
      ...(nav.screen !== undefined && { screen: nav.screen }),
      ...(nav.parent !== undefined && { parent: nav.parent }),
      ...(visibleWorkspaces.length > 0 && { workspaces: visibleWorkspaces }),
    });
  }
  return withoutOrphanedNavs(result);
}

// A child under a parent hidden from this role would point at an id that
// isn't in the manifest; hiding cascades down the whole subtree.
function withoutOrphanedNavs(navs: readonly AgentManifestNav[]): readonly AgentManifestNav[] {
  let remaining = navs;
  for (;;) {
    const ids = new Set(remaining.map((nav) => nav.id));
    const reachable = remaining.filter((nav) => nav.parent === undefined || ids.has(nav.parent));
    if (reachable.length === remaining.length) return remaining;
    remaining = reachable;
  }
}

// Qualified handler, screen and nav ids all start with the owning feature name.
function featureNameOf(qualifiedId: string): string {
  const idx = qualifiedId.indexOf(":");
  return idx === -1 ? qualifiedId : qualifiedId.slice(0, idx);
}

function visibleFeatureNamesOf(
  handlers: readonly AgentManifestHandler[],
  screens: readonly AgentManifestScreen[],
  navs: readonly AgentManifestNav[],
): ReadonlySet<string> {
  return new Set(
    [...handlers.map((h) => h.qn), ...screens.map((s) => s.id), ...navs.map((n) => n.id)].map(
      featureNameOf,
    ),
  );
}

function entitiesOfQueryToolsFor(
  registry: RegistryManifestView,
  roles: readonly string[],
  denyQns: ReadonlySet<string>,
): readonly string[] {
  const names: string[] = [];
  for (const [qn, def] of registry.getAllQueryHandlers()) {
    const entityName = registry.getHandlerEntity(qn);
    if (entityName === undefined || denyQns.has(qn) || isExplicitlyAgentHidden(def)) continue;
    if (hasAccess({ roles }, def.access)) names.push(entityName);
  }
  return names;
}

// A reference target is "entity" or "<feature>:entity"; registry entity keys are the bare name.
function entityNameOfReference(target: string): string {
  return target.slice(target.lastIndexOf(":") + 1);
}

function referenceTargetsOf(entity: EntityDefinition | undefined): readonly string[] {
  return Object.values(entity?.fields ?? {}).flatMap((field) =>
    field.type === "reference" ? [entityNameOfReference(field.entity)] : [],
  );
}

/** Reachable = tagged on a manifest handler, shown by a manifest screen, or read by a
 *  registry-derived `get_`/`list_` tool (which takes labels from the manifest entity). */
function visibleEntityNamesOf(
  registry: RegistryManifestView,
  roles: readonly string[],
  denyQns: ReadonlySet<string>,
  handlers: readonly AgentManifestHandler[],
  screens: readonly AgentManifestScreen[],
): ReadonlySet<string> {
  const reachable = new Set<string>([
    ...handlers.flatMap((handler) => (handler.entity !== undefined ? [handler.entity] : [])),
    ...screens.flatMap((screen) => [screen.entity ?? [], screen.detailFor ?? []].flat()),
    ...entitiesOfQueryToolsFor(registry, roles, denyQns),
  ]);
  const entities = registry.getAllEntities();
  return new Set([
    ...reachable,
    ...[...reachable].flatMap((n) => referenceTargetsOf(entities.get(n))),
  ]);
}

function lastSegment(qualifiedId: string): string {
  const idx = qualifiedId.lastIndexOf(":");
  return idx === -1 ? qualifiedId : qualifiedId.slice(idx + 1);
}

function detailIdParam(screen: ScreenDefinition): string {
  return screen.type === "projectionDetail" ? (screen.idParam ?? "id") : "id";
}

function screenTitles(
  translations: TranslationKeys,
  screenId: string,
  shortId: string,
  locale: string,
): { readonly title?: string } {
  const title = pickLabel(
    entryAsLabels(
      translations[`${screenId}.title`] ?? translations[`screen:${shortId}.title`] ?? {},
    ),
    locale,
  );
  return title === undefined ? {} : { title };
}

function buildScreenEntry(
  screen: ScreenDefinition,
  screenWorkspaces: readonly string[],
  translations: TranslationKeys,
  locale: string,
): AgentManifestScreen {
  return {
    id: screen.id,
    type: screen.type,
    ...screenTitles(translations, screen.id, lastSegment(screen.id), locale),
    // `screen.description` may be a raw i18n key (`registry.getAllTranslations()`
    // double-prefixes it, see build-app-schema.ts:77-81) — match on suffix like
    // `labelsForSuffix` does for entity/field labels, else fall back to the
    // literal string as authored.
    ...(screen.description !== undefined && {
      description:
        pickLabel(labelsForSuffix(translations, screen.description), locale) ?? screen.description,
    }),
    ...("entity" in screen && screen.entity !== undefined && { entity: screen.entity }),
    // A detail screen takes the row id under its idParam; everything else is parameterless.
    ...(screen.detailFor !== undefined && { params: [detailIdParam(screen)] }),
    ...(screenWorkspaces.length > 0 && { workspaces: screenWorkspaces }),
    ...(screen.detailFor !== undefined && { detailFor: screen.detailFor }),
    ...("handler" in screen && typeof screen.handler === "string" && { handler: screen.handler }),
  };
}

function buildScreens(
  screens: ReadonlyMap<string, ScreenDefinition>,
  navs: ReadonlyMap<string, NavDefinition>,
  workspaces: ReadonlyMap<string, WorkspaceDefinition>,
  translations: TranslationKeys,
  roles: readonly string[],
  visibleNavIds: ReadonlySet<string>,
  locale: string,
): readonly AgentManifestScreen[] {
  const allNavs = [...navs.values()];
  const result: AgentManifestScreen[] = [];

  for (const [, screen] of screens) {
    // An opted-out screen must not reach the manifest at all — the tool catalog
    // builds `navigate`'s screen-id enum straight from `manifest.screens`.
    if (!isAgentVisibleScreen(screen)) continue;
    const matchingNavs = allNavs.filter((nav) => nav.screen === screen.id);
    const accessibleNavs = matchingNavs.filter(
      (nav) => visibleNavIds.has(nav.id) && uiVisible(nav.access, roles),
    );

    // A screen with no nav pointing at it is a detail view, reached only via
    // navigation from a list row — never hidden by nav/workspace gating.
    const reachable =
      matchingNavs.length === 0 ||
      accessibleNavs.some((nav) => {
        if (!nav.workspaces || nav.workspaces.length === 0) return true;
        return visibleWorkspaceIds(nav.workspaces, workspaces, roles).length > 0;
      });
    if (!uiVisible(screen.access, roles) || !reachable) continue;

    const screenWorkspaces = dedupeSorted(
      accessibleNavs.flatMap((nav) => visibleWorkspaceIds(nav.workspaces, workspaces, roles)),
    );

    result.push(buildScreenEntry(screen, screenWorkspaces, translations, locale));
  }
  return result;
}

function buildWorkspaces(
  workspaces: ReadonlyMap<string, WorkspaceDefinition>,
  translations: TranslationKeys,
  roles: readonly string[],
  locale: string,
): readonly AgentManifestWorkspace[] {
  const result: AgentManifestWorkspace[] = [];
  for (const [, workspace] of workspaces) {
    if (!uiVisible(workspace.access, roles)) continue;
    result.push({
      id: workspace.id,
      ...labelProp(entryAsLabels(translations[workspace.label] ?? {}), locale),
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
  assertDenyQnsExist(options.denyQns ?? [], registry);

  const denyQns = new Set(options.denyQns ?? []);
  const handlers = buildHandlers(
    registry.getAllQueryHandlers(),
    registry.getAllWriteHandlers(),
    roles,
    (qn) => registry.getHandlerEntity(qn),
    denyQns,
  );
  const screenMap = registry.getAllScreens();
  const navs = buildNavs(navMap, workspaceMap, translations, roles, screenMap, options.locale);
  const screens = buildScreens(
    screenMap,
    navMap,
    workspaceMap,
    translations,
    roles,
    new Set(navs.map((nav) => nav.id)),
    options.locale,
  );
  const workspaces = buildWorkspaces(workspaceMap, translations, roles, options.locale);
  const features = buildFeatures(registry.features, visibleFeatureNamesOf(handlers, screens, navs));
  const entities = buildEntities(
    registry.getAllEntities(),
    translations,
    (name) => registry.getSearchableFields(name),
    visibleEntityNamesOf(registry, roles, denyQns, handlers, screens),
    options.locale,
  );

  const manifest: AgentManifest = {
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
  recordManifestDenyQns(manifest, denyQns);
  return manifest;
}
