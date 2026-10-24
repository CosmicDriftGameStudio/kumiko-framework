// Builds the client-safe AppSchema from a server registry for the
// browser renderer pipeline. The dev server can therefore drop its entire
// hand-written `clientSchema` mirror and simply send the resolved AppSchema
// during boot.
//
// JSON safety: project explicitly onto a whitelist instead of round-tripping
// through JSON.stringify. Functions would be silently dropped, and Zod schemas
// (v4 has .toJSON, but emits a _zod envelope) would appear as strange ghost
// properties. This is an intentional contract: everything read by the browser
// renderer pipeline must appear here. New fields needed by the browser must be
// added explicitly.
//
// Currently projected:
//   Entity:    { table?, fields: { type, required?, sortable?, default? } }
//   Screen:    verbatim (ScreenDefinition is JSON-safe by design —
//              custom screens have no functions; layout/columns/etc. are
//              plain literals)
//   Nav:       verbatim (NavDefinition contains only strings + literals)
//   Workspace: verbatim definition + getWorkspaceNavs() from the registry
//   Translations: verbatim feature.translations (raw r.translations keys,
//                 unfiltered — see FeatureSchema.translations doc)
//
// Feature toggles: this schema is tenant-independent and lists every feature.
// The schema route strips features the caller's tenant has switched off
// (r.toggleable) via stripDisabledFeaturesFromAppSchema.

import type { EntityWriteExcludedFields } from "@cosmicdrift/kumiko-types/screen";
import { ZodObject, type ZodType } from "zod";
import { createFallbackLogger } from "../logging/utils.ts";
import type {
  AppSchema,
  ConfigEditScreenDefinition,
  EntityDefinition,
  FeatureSchema,
  ProjectionListScreenDefinition,
  ScreenDefinition,
  WorkspaceSchema,
} from "../ui-types/index.ts";

import { collectUrlPrefillFieldsByScreenQn } from "./boot-validator/url-prefill-fields.ts";
import {
  buildConfigFeatureSchema,
  type ConfigFeatureSchema,
  SETTINGS_HUB_FEATURE,
} from "./build-config-feature-schema.ts";
import { isEncryptedAtRest } from "./config-helpers.ts";
import { isListQueryWithoutSearchableFields } from "./entity-list-searchability.ts";
import { QnTypes, qualifyEntityName } from "./qualified-name.ts";
import type { Registry } from "./types/feature.ts";
import type {
  ClientDerivedFieldDef,
  DerivedFieldDef,
  EntityFieldDefinition,
  FieldDefinition,
} from "./types/fields.ts";

const log = createFallbackLogger("kumiko");

// Workspace ids are only unique per feature, and the schema carries the short id. The owner stays
// off the serialized schema; the tenant-level feature strip reads it from here by object identity.
const workspaceOwnerByDefinition = new WeakMap<WorkspaceSchema["definition"], string>();

export function workspaceOwnerOf(definition: WorkspaceSchema["definition"]): string | undefined {
  return workspaceOwnerByDefinition.get(definition);
}

export type BuildAppSchemaOptions = {
  /** Dev-server authoring hints (Settings-Hub placement). Default off — only
   *  `createKumikoServer` opts in; prod boot + unit tests stay silent. */
  readonly authoringWarnings?: boolean;
  /** Forwarded onto every FeatureSchema.searchAdapterMissing. Set by the boot
   *  entrypoint (createKumikoServer, runProdApp) from its own
   *  context.searchAdapter presence check — buildAppSchema itself has no
   *  context, only the registry. Omit/false when a SearchAdapter is wired. */
  readonly searchAdapterMissing?: boolean;
};

export function buildAppSchema(registry: Registry, options: BuildAppSchemaOptions = {}): AppSchema {
  const features: FeatureSchema[] = [];
  const urlPrefillFieldsByScreenQn = collectUrlPrefillFieldsByScreenQn([
    ...registry.features.values(),
  ]);
  const encryptedConfigKeyQns = collectEncryptedConfigKeyQns(registry);
  for (const [featureName, feature] of registry.features) {
    // r.nav() may carry explicit `undefined` optionals; drop them so the
    // schema stays free of non-JSON-safe values.
    const navs = Object.values(feature.navs).map(
      (nav) =>
        Object.fromEntries(
          Object.entries(nav).filter(([, value]) => value !== undefined),
        ) as typeof nav, // @cast-boundary generic-record
    );
    // The nav entry alone doesn't say which kind a collection lists, so the
    // client can't derive its tree provider from `navs` — project the
    // collections separately, with the nav QN already qualified.
    const contentCollections = Object.values(feature.contentCollections ?? {}).map(
      (collection) => ({
        ...collection,
        navQn: `${featureName}:nav:${collection.id}`,
      }),
    );
    const featureSchema: FeatureSchema = {
      featureName,
      entities: projectEntities(feature.entities ?? {}),
      screens: projectScreens(
        featureName,
        feature.screens,
        registry,
        urlPrefillFieldsByScreenQn,
        encryptedConfigKeyQns,
      ),
      ...(navs.length > 0 && { navs }),
      ...(contentCollections.length > 0 && { contentCollections }),
      // Verbatim r.translations({keys}) — see FeatureSchema.translations
      // doc for why this must NOT go through registry.getAllTranslations()
      // (double-prefixes features that already qualify their own keys).
      ...(Object.keys(feature.translations ?? {}).length > 0 && {
        translations: feature.translations,
      }),
      ...(options.searchAdapterMissing === true && { searchAdapterMissing: true }),
    };
    features.push(featureSchema);
  }

  // Workspaces: getAllWorkspaces() returns QUALIFIED ids (the Registry writes
  // them during store overwrite). The browser renderer expects short ids
  // (matching the URL segment and navigate({ workspaceId })). We therefore
  // read directly from `feature.workspaces`, where the ids are still in the
  // author's short form, and obtain the pre-resolved navMembers from the
  // registry.
  let workspaces: WorkspaceSchema[] = [];
  for (const [featureName, feature] of registry.features) {
    for (const [shortId, definition] of Object.entries(feature.workspaces)) {
      const qualified = `${featureName}:workspace:${shortId}`;
      const projectedDefinition = { ...definition, id: shortId };
      workspaceOwnerByDefinition.set(projectedDefinition, featureName);
      workspaces.push({
        definition: projectedDefinition,
        navMembers: registry.getWorkspaceNavs(qualified),
      });
    }
  }

  // Self-populating Settings Hub: screens/navs (plus one workspace) are
  // derived from the declared config keys with `mask` and attached here,
  // so the app author does not need manual r.screen/r.nav declarations.
  const appHadWorkspaces = workspaces.length > 0;
  const generated = buildConfigFeatureSchema(registry);
  if (generated.screens.length > 0) {
    mergeSettingsHubIntoConfigFeature(features, generated);
    // Flip protection: applies only to apps that already use workspaces. For an
    // app without workspaces, app.workspaces remains undefined, so the renderer
    // shows all navs without filtering, including the Hub navs.
    if (appHadWorkspaces) {
      const placed = placeSettingsHub(workspaces, generated);
      workspaces = placed.workspaces;
      if (placed.standalone !== undefined) workspaces.push(placed.standalone);
      if (options.authoringWarnings === true) {
        warnUnplacedAudiences(placed.unplaced);
        warnDanglingAudienceRefs(placed.danglingRefs);
      }
    }
  }

  const schema = {
    features,
    ...(workspaces.length > 0 && { workspaces }),
  };

  if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
    // A stringify-roundtrip comparison can never fire here: JSON.stringify
    // drops functions/undefined identically on both sides. Walk the value
    // instead so a leaked function renderer is actually caught.
    const offender = findNonJsonSafePath(schema, "schema");
    if (offender !== null) {
      log.error(
        `buildAppSchema: output is not JSON-safe, non-serializable value at "${offender}" (a function renderer or class instance in the schema?).`,
        { offender },
      );
    }
  }

  return schema;
}

// Attaches the generated Hub screens/navs to the config FeatureSchema
// (qualified as config:screen:* / config:nav:*). If it does not yet exist
// (because the config bundled feature is not mounted), it is created. Using
// find-or-create instead of an unconditional push prevents a second
// FeatureSchema with the same featureName.
function mergeSettingsHubIntoConfigFeature(
  features: FeatureSchema[],
  generated: ConfigFeatureSchema,
): void {
  const existing = features.find((f) => f.featureName === SETTINGS_HUB_FEATURE);
  if (existing === undefined) {
    features.push({
      featureName: SETTINGS_HUB_FEATURE,
      entities: {},
      screens: generated.screens,
      navs: generated.navs,
      ...(generated.translations !== undefined && { translations: generated.translations }),
    });
  } else {
    features[features.indexOf(existing)] = {
      ...existing,
      screens: [...existing.screens, ...generated.screens],
      navs: [...(existing.navs ?? []), ...generated.navs],
      ...(generated.translations !== undefined && {
        translations: { ...existing.translations, ...generated.translations },
      }),
    };
  }
}

// Audience children referenced via navMembers get attached inline (slice-filter would otherwise hide non-member children); the standalone switcher keeps only unplaced audiences so nothing duplicates or silently vanishes.
function placeSettingsHub(
  appWorkspaces: readonly WorkspaceSchema[],
  generated: ConfigFeatureSchema,
): {
  workspaces: WorkspaceSchema[];
  standalone: WorkspaceSchema | undefined;
  unplaced: string[];
  danglingRefs: string[];
} {
  const prefix = `${SETTINGS_HUB_FEATURE}:nav:`;
  const audienceShortIds = new Set<string>();
  const childParent = new Map<string, string>();
  const childrenByAudience = new Map<string, string[]>();
  for (const nav of generated.navs) {
    if (nav.parent === undefined) {
      audienceShortIds.add(nav.id);
    } else {
      childParent.set(nav.id, nav.parent);
      const list = childrenByAudience.get(nav.parent) ?? [];
      list.push(nav.id);
      childrenByAudience.set(nav.parent, list);
    }
  }

  const placedAudiences = new Set<string>();
  // Config-hub navs a workspace references but that were never generated (no
  // audience and no known child) — e.g. `config:nav:audience-user` without any
  // registered user-scope config keys. Otherwise the reference vanishes
  // silently (silent-skip).
  const danglingRefs = new Set<string>();
  const workspaces = appWorkspaces.map((ws) => {
    const additions: string[] = [];
    for (const member of ws.navMembers) {
      if (!member.startsWith(prefix)) continue;
      const shortId = member.slice(prefix.length);
      if (!audienceShortIds.has(shortId)) {
        if (!childParent.has(shortId)) danglingRefs.add(shortId);
        continue;
      }
      placedAudiences.add(shortId);
      for (const child of childrenByAudience.get(shortId) ?? []) {
        const childQn = `${prefix}${child}`;
        if (!ws.navMembers.includes(childQn) && !additions.includes(childQn)) {
          additions.push(childQn);
        }
      }
    }
    return additions.length > 0 ? { ...ws, navMembers: [...ws.navMembers, ...additions] } : ws;
  });

  const audienceOf = (shortId: string): string =>
    audienceShortIds.has(shortId) ? shortId : (childParent.get(shortId) ?? shortId);
  let standalone: WorkspaceSchema | undefined;
  if (generated.workspace !== undefined && placedAudiences.size < audienceShortIds.size) {
    const remaining = generated.workspace.navMembers.filter((member) => {
      const shortId = member.startsWith(prefix) ? member.slice(prefix.length) : member;
      return !placedAudiences.has(audienceOf(shortId));
    });
    if (remaining.length > 0) standalone = { ...generated.workspace, navMembers: remaining };
  }

  const unplaced =
    placedAudiences.size > 0 ? [...audienceShortIds].filter((id) => !placedAudiences.has(id)) : [];
  return { workspaces, standalone, unplaced, danglingRefs: [...danglingRefs] };
}

function warnUnplacedAudiences(unplaced: readonly string[]): void {
  // skip: every audience placed — nothing to warn about
  if (unplaced.length === 0) return;
  log.warn(
    `Settings-Hub: ${unplaced.join(", ")} nicht in einer App-Workspace platziert — ` +
      `erscheint im Standalone-"Einstellungen"-Tab. Referenziere ` +
      `${unplaced.map((id) => `${SETTINGS_HUB_FEATURE}:nav:${id}`).join(", ")} ` +
      `in einer r.workspace.nav, um die Gruppe inline zu zeigen.`,
  );
}

function warnDanglingAudienceRefs(dangling: readonly string[]): void {
  // skip: no dangling refs — nothing to warn about
  if (dangling.length === 0) return;
  log.warn(
    `Settings-Hub: ${dangling
      .map((id) => `${SETTINGS_HUB_FEATURE}:nav:${id}`)
      .join(", ")} in einer Workspace referenziert, aber nie generiert — ` +
      `keine Config-Keys für diesen Scope registriert. Tippfehler oder ` +
      `vorzeitige Referenz? Der Eintrag rendert sonst unsichtbar.`,
  );
}

// PlatformComponent slots ({ react, native }) legitimately hold component
// functions — JSON.stringify drops them at inject-time and the client
// re-resolves by name, so the walker treats them as opaque.
function isPlatformComponentShape(value: object): boolean {
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((k) => k === "react" || k === "native");
}

// Returns the path of the first value JSON.stringify would drop or distort
// (function, undefined, symbol, bigint, non-finite number, class instance) —
// or null when the value is JSON-safe apart from PlatformComponent slots.
export function findNonJsonSafePath(value: unknown, path: string): string | null {
  if (value === null || typeof value === "string" || typeof value === "boolean") return null;
  if (typeof value === "number") return Number.isFinite(value) ? null : path;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findNonJsonSafePath(value[i], `${path}[${i}]`);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return path;
    if (isPlatformComponentShape(value)) return null;
    for (const [key, entry] of Object.entries(value)) {
      const hit = findNonJsonSafePath(entry, `${path}.${key}`);
      if (hit !== null) return hit;
    }
    return null;
  }
  // function, symbol, bigint, undefined
  return path;
}

// projectionList screens don't declare searchable/sortable/paginated as
// authoring intent — they're derived here from the bound query handler's
// Zod schema, the source of truth for what parameters it actually accepts.
// A hand-written `searchable: true` still wins over the derived
// default (screen.searchable ?? derived); the boot-validator (3a) rejects
// one that contradicts the schema.
function projectScreens(
  featureName: string,
  screens: Readonly<Record<string, ScreenDefinition>>,
  registry: Registry,
  urlPrefillFieldsByScreenQn: ReadonlyMap<string, ReadonlySet<string>>,
  encryptedConfigKeyQns: ReadonlySet<string>,
): ScreenDefinition[] {
  return Object.entries(screens).map(([shortId, screen]) => {
    assertValidScreenMultilineRows(featureName, shortId, screen);
    if (screen.type === "configEdit") return projectConfigEditScreen(screen, encryptedConfigKeyQns);
    if (screen.type === "projectionList") return projectProjectionListScreen(screen, registry);
    if (screen.type === "entityEdit") {
      const { writeExcludedFields: _authoredExclusions, ...authoredScreen } = screen;
      return {
        ...authoredScreen,
        urlPrefillFields: sortedUrlPrefillFields(
          urlPrefillFieldsByScreenQn.get(qualifyEntityName(featureName, "screen", shortId)),
        ),
        ...entityEditWriteExcludedFields(featureName, screen.entity, registry),
      };
    }
    if (screen.type === "actionForm") {
      const { writeExcludedFields: _authoredExclusions, ...authoredScreen } = screen;
      const excluded = registry.getWriteHandler(screen.handler)?.excludedFields;
      return {
        ...authoredScreen,
        urlPrefillFields: sortedUrlPrefillFields(
          urlPrefillFieldsByScreenQn.get(qualifyEntityName(featureName, "screen", shortId)),
        ),
        ...(excluded !== undefined && { writeExcludedFields: excluded }),
      };
    }
    if (screen.type === "secretMint") {
      return {
        ...screen,
        urlPrefillFields: sortedUrlPrefillFields(
          urlPrefillFieldsByScreenQn.get(qualifyEntityName(featureName, "screen", shortId)),
        ),
      };
    }
    return screen;
  });
}

function sortedUrlPrefillFields(declared: ReadonlySet<string> | undefined): string[] {
  return declared === undefined ? [] : [...declared].sort();
}

// The screen is the one thing the renderer reads, so the per-verb excludeFields
// of the entity's generic create/update handlers are projected onto it here.
function entityEditWriteExcludedFields(
  featureName: string,
  entityName: string,
  registry: Registry,
): { writeExcludedFields?: EntityWriteExcludedFields } {
  const excludedFor = (verb: "create" | "update"): readonly string[] | undefined =>
    registry.getWriteHandler(`${qualifyEntityName(featureName, QnTypes.write, entityName)}:${verb}`)
      ?.excludedFields;
  const create = excludedFor("create");
  const update = excludedFor("update");
  if (create === undefined && update === undefined) return {};
  return {
    writeExcludedFields: {
      ...(create !== undefined && { create }),
      ...(update !== undefined && { update }),
    },
  };
}

function collectEncryptedConfigKeyQns(registry: Registry): ReadonlySet<string> {
  const qns = new Set<string>();
  for (const [featureName, feature] of registry.features) {
    for (const [key, def] of Object.entries(feature.configKeys)) {
      if (isEncryptedAtRest(def)) qns.add(qualifyEntityName(featureName, QnTypes.config, key));
    }
  }
  return qns;
}

// A hand-written configEdit field over an encrypted-at-rest key would load the
// read mask as editable text and a partial edit would overwrite the secret with
// it. Forcing writeOnly here matches what deriveField does for generated screens.
function projectConfigEditScreen(
  screen: ConfigEditScreenDefinition,
  encryptedConfigKeyQns: ReadonlySet<string>,
): ConfigEditScreenDefinition {
  let fields: Record<string, FieldDefinition> | undefined;
  for (const [fieldName, field] of Object.entries(screen.fields)) {
    const qualified = screen.configKeys[fieldName];
    if (field.type !== "text" || qualified === undefined || !encryptedConfigKeyQns.has(qualified)) {
      continue;
    }
    fields ??= { ...screen.fields };
    fields[fieldName] = { ...field, writeOnly: true };
  }
  return fields === undefined ? screen : { ...screen, fields };
}

function projectProjectionListScreen(
  screen: ProjectionListScreenDefinition,
  registry: Registry,
): ProjectionListScreenDefinition {
  const handler = registry.getQueryHandler(screen.query);
  const capabilities = deriveProjectionListCapabilities(handler?.schema);
  // A search box over an entity without searchable fields would never match.
  const searchable =
    capabilities.searchable &&
    !isListQueryWithoutSearchableFields(screen.query, handler, (name) => registry.getEntity(name));
  return {
    ...screen,
    searchable: screen.searchable ?? searchable,
    sortable: capabilities.sortable,
    paginated: capabilities.paginated,
  };
}

// Zod v4: a ZodObject's param names live on `.shape`. A schema that isn't a
// ZodObject (e.g. a z.union across payload shapes) yields no capability
// instead of throwing — same as a missing/unresolved query handler.
function deriveProjectionListCapabilities(schema: ZodType | undefined): {
  searchable: boolean;
  sortable: boolean;
  paginated: boolean;
} {
  const shape = schema instanceof ZodObject ? schema.shape : undefined;
  return {
    searchable: shape !== undefined && "search" in shape,
    sortable: shape !== undefined && "sort" in shape,
    paginated: shape !== undefined && ("cursor" in shape || "offset" in shape),
  };
}

function projectEntities(
  entities: Readonly<Record<string, EntityDefinition>>,
): Readonly<Record<string, EntityDefinition>> {
  const out: Record<string, EntityDefinition> = {};
  for (const [name, entity] of Object.entries(entities)) {
    out[name] = projectEntity(name, entity);
  }
  return out;
}

// EntityDefinition is a discriminated union of field types, and we know the
// JSON-safe properties for each type. Rather than handling every variant
// separately, walk the field map and filter it through the whitelist. Values
// that do not pass through include server-only runtime values such as
// ZodValidate functions, computed functions, and default functions.
function projectEntity(entityName: string, entity: EntityDefinition): EntityDefinition {
  const fieldsOut: Record<string, EntityFieldDefinition> = {};
  for (const [fieldName, fieldDef] of Object.entries(entity.fields)) {
    assertValidMultilineRows(`Entity "${entityName}"`, fieldName, fieldDef);
    fieldsOut[fieldName] = projectField(fieldDef);
  }
  // derivedFields MUST be included in the client schema (metadata only, not the
  // derive function): computeListViewModel resolves an entityList column via
  // `entity.derivedFields[field].valueType`; without the entry it throws
  // "references unknown field". The executor has already attached the value
  // server-side to the row; the client only needs valueType for rendering.
  const derivedOut: Record<string, ClientDerivedFieldDef> = {};
  for (const [name, derivedDef] of Object.entries(entity.derivedFields ?? {})) {
    derivedOut[name] = projectDerivedField(derivedDef);
  }
  // EntityDefinition accepts idType/access/searchWeight as optional, but we omit
  // them because the browser renderer does not read them. `table` is included
  // in case apps reference `entity.table` directly.
  // No cast is needed: all omitted fields are optional (`?`).
  return {
    fields: fieldsOut,
    // @cast-boundary schema-walk: EntityDefinition.derivedFields is typed for
    // the SERVER (derive required); this is the one place a client schema
    // narrows it to ClientDerivedFieldDef (valueType only) — the cast lives
    // at the actual server/client type boundary instead of inside
    // projectDerivedField, which now honestly returns the narrower type.
    ...(Object.keys(derivedOut).length > 0 && {
      derivedFields: derivedOut as unknown as Record<string, DerivedFieldDef>,
    }),
    ...(typeof entity.table === "string" && { table: entity.table }),
    ...(typeof entity.defaultCurrency === "string" && {
      defaultCurrency: entity.defaultCurrency,
    }),
    ...(entity.lockedWhen !== undefined && { lockedWhen: entity.lockedWhen }),
  };
}

// Only valueType is forwarded — the derive function is server-only and is not
// JSON-safe (it would otherwise trigger the output-walk guard). Return
// ClientDerivedFieldDef honestly instead of pretending to return a
// DerivedFieldDef without its derive function.
function projectDerivedField(derivedDef: DerivedFieldDef): ClientDerivedFieldDef {
  return { valueType: derivedDef.valueType };
}

// A textarea height that is not a positive integer cannot render anywhere; fail
// at boot with the field name instead of letting each renderer guess a fallback.
function assertValidMultilineRows(
  owner: string,
  fieldName: string,
  fieldDef: FieldDefinition,
): void {
  const multiline =
    fieldDef.type === "text" || fieldDef.type === "longText" ? fieldDef.multiline : undefined;
  const rows: unknown = typeof multiline === "object" ? multiline.rows : undefined;
  // Non-number values are not JSON-safe and get dropped by the projection below.
  if (typeof rows === "number" && (!Number.isInteger(rows) || rows < 1)) {
    throw new Error(
      `${owner} field "${fieldName}": multiline.rows must be a positive integer, got ${rows}`,
    );
  }
}

// Screen forms carry their own inline field maps into the client schema.
function assertValidScreenMultilineRows(
  featureName: string,
  shortId: string,
  screen: ScreenDefinition,
): void {
  const owner = `Screen "${featureName}:${shortId}"`;
  const check = (fields: Readonly<Record<string, FieldDefinition>>): void => {
    for (const [fieldName, fieldDef] of Object.entries(fields)) {
      assertValidMultilineRows(owner, fieldName, fieldDef);
    }
  };
  if (screen.type === "configEdit" || screen.type === "actionForm") check(screen.fields);
  if (screen.type === "secretMint") {
    check(screen.fields);
    if (screen.confirm !== undefined) check(screen.confirm.fields);
  }
}

// Per-field whitelist. Every forwarded value must be JSON-safe (literal, or
// an array/plain-object built only from JSON-safe values) — even though the
// FieldDefinition types only type `default` as a literal, the sample-authoring
// pattern `as unknown as EntityDefinition` has already let function-valued
// defaults slip through. This whitelist is defense-in-depth that catches them
// BEFORE JSON.stringify silently drops them in the browser-injection pipeline.
// The same check gates the structured properties below (`multiline`,
// `derived`, `totals`, `totalsMatch`) — a top-level `Array.isArray`/plain-
// object check alone would let a function survive one level deep.
//
// Cast at the exit `as EntityFieldDefinition`: type-system-wise our out-map only
// satisfies the discriminated union with an unnarrowed `type` string — the
// cast bridges the variant inference TS can't recompute from a generic
// Record.
type FieldPropertyGate = (value: unknown) => boolean;

const isStringValue: FieldPropertyGate = (value) => typeof value === "string";
const isBooleanValue: FieldPropertyGate = (value) => typeof value === "boolean";
const isNumberValue: FieldPropertyGate = (value) => typeof value === "number";
const isTrueValue: FieldPropertyGate = (value) => value === true;
const isNumberOrStringValue: FieldPropertyGate = (value) =>
  typeof value === "number" || typeof value === "string";
const isBooleanOrJsonSafeObject: FieldPropertyGate = (value) =>
  typeof value === "boolean" || isJsonSafeObject(value);
const isUnitSpec: FieldPropertyGate = (value) =>
  typeof value === "string" || (isPlainObject(value) && typeof value["field"] === "string");

// Forwarded in this order, so the client schema keeps its key order.
const FORWARDED_FIELD_PROPERTIES: readonly (readonly [
  key: string,
  isForwarded: FieldPropertyGate,
])[] = [
  ["type", isStringValue],
  ["required", isBooleanValue],
  ["sortable", isBooleanValue],
  // filterable controls the faceted filter dropdowns in the renderer (select/
  // boolean), so it must be included in the client schema.
  ["filterable", isBooleanValue],
  ["searchable", isBooleanValue],
  ["default", isJsonSafeValue],
  // Select: the options list is plain JSON, so forward it.
  ["options", Array.isArray],
  ["optionTones", isJsonSafeObject],
  // Reference: entity target, labelField, and multiple are required by the
  // renderer. ReferenceInput builds the options query from refEntity/refFeature
  // and resolves the label through labelField; without these properties, the
  // dropdown is empty (the QN becomes `<feature>:query::list` → 404).
  ["entity", isStringValue],
  ["labelField", isStringValue],
  // Author-supplied picker source — without it the client falls back to the list handler.
  ["optionsQuery", isStringValue],
  // Select: tier/tenant availability of the static options, loaded by the renderer.
  ["optionsAvailabilityQuery", isStringValue],
  // Select: options only offered while a sibling-field condition holds; the renderer filters, the write path enforces.
  ["conditionalOptions", Array.isArray],
  ["multiple", isBooleanValue],
  // MultiSelect: display picks checkboxes vs. combobox in the renderer,
  // columns/maxRows size the checkbox grid — without these the renderer
  // always falls back to the combobox. Select: display picks
  // "radio" | "dropdown" the same way.
  ["display", isStringValue],
  ["columns", isNumberValue],
  ["maxRows", isNumberValue],
  // text/longText: textarea row count — DefaultInput renders a single-line
  // input otherwise.
  ["multiline", isBooleanOrJsonSafeObject],
  // number: Zod write-boundary bounds. date/timestamp/locatedTimestamp:
  // ISO-string picker bounds — same keys, different literal type.
  ["min", isNumberOrStringValue],
  ["max", isNumberOrStringValue],
  // date/timestamp/locatedTimestamp: display/parsing locale override.
  ["locale", isStringValue],
  // image/images: which camera a mobile capture opens.
  ["capture", isStringValue],
  // number: display-only suffix, static or read from a sibling field of the row.
  ["unit", isUnitSpec],
  // number/decimal/bigInt: `false` drops thousands separators (e.g. a year).
  ["grouping", isBooleanValue],
  // text: "password" masks the input and blocks URL prefill in the renderer.
  ["format", isStringValue],
  // Write-response redaction stays server-side; the renderer needs the flag to
  // refuse any prefill (URL or handoff) into the field.
  ["sensitive", isTrueValue],
  // Without it the renderer shows a plain text input for a field whose value never leaves the server.
  ["writeOnly", isTrueValue],
  // timestamp: the edit view-model derives its wall-clock input mode from this.
  ["locatedBy", isStringValue],
  // file/image/images: upload picker constraints; the first variant key picks
  // the preview variant.
  ["accept", isJsonSafeArray],
  ["maxSize", isStringValue],
  ["variants", isJsonSafeObject],
  // decimal, incl. embedded sub-fields: rounding of derived embedded-list cells.
  ["scale", isNumberValue],
  // money: declared currency source (MoneyCurrencySource) — without
  // it the renderer can't tell a "currency: { kind: 'tenant' }" field apart
  // from an undeclared one and always falls back to entity.defaultCurrency.
  ["currency", isJsonSafeObject],
  // embedded lists: row-count bounds, computed cells, totals row, and the
  // sibling-money-field totals check.
  ["minItems", isNumberValue],
  ["maxItems", isNumberValue],
  ["derived", isJsonSafeObject],
  ["totals", isJsonSafeArray],
  ["totalsMatch", isJsonSafeObject],
];

function projectField(fieldDef: FieldDefinition): EntityFieldDefinition {
  const def = fieldDef as Record<string, unknown>; // @cast-boundary schema-walk
  const out: Record<string, unknown> = {};
  for (const [key, isForwarded] of FORWARDED_FIELD_PROPERTIES) {
    if (isForwarded(def[key])) out[key] = def[key];
  }
  // embedded lists: the sub-field map itself — without it the client-side
  // edit view-model iterates `undefined` and the screen crashes.
  // Recursive per sub-field, NOT a blanket isJsonSafeValue gate: a single
  // sub-field carrying a validator fn would otherwise drop the whole map,
  // and a blanket copy would ship server internals.
  if (isPlainObject(def["schema"])) {
    out["schema"] = Object.fromEntries(
      Object.entries(def["schema"]).map(([k, v]) => [k, projectField(v as FieldDefinition)]), // @cast-boundary schema-walk
    );
  }
  return out as EntityFieldDefinition; // @cast-boundary schema-walk
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isJsonSafeObject(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && isJsonSafeValue(value);
}

function isJsonSafeArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value) && isJsonSafeValue(value);
}

// `ancestors` tracks the current path only, so a shared (non-cyclic) sub-object
// stays valid while a self-reference returns false instead of overflowing the stack.
function isJsonSafeValue(value: unknown, ancestors: Set<object> = new Set()): boolean {
  if (value === null) return true;
  const t = typeof value;
  if (t === "string" || t === "boolean") return true;
  // NaN/Infinity serialize to null via JSON.stringify.
  if (t === "number") return Number.isFinite(value);
  if (typeof value !== "object" || !(Array.isArray(value) || isPlainObject(value))) return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  const children: readonly unknown[] = Array.isArray(value) ? value : Object.values(value);
  const safe = children.every((child) => isJsonSafeValue(child, ancestors));
  ancestors.delete(value);
  return safe;
}
