// Erzeugt aus einer Server-Registry das client-safe AppSchema das die
// Browser-Renderer-Pipeline konsumiert. Genauer Zweck: dev-server kann
// die ganze hand-geschriebene `clientSchema`-Spiegelung abschaffen, der
// Server schickt einfach das aufgelöste AppSchema beim Boot mit.
//
// JSON-Safety: Wir projezieren explizit auf eine Whitelist statt
// JSON.stringify-roundtripping. Functions würden silent gedroppt und
// Zod-Schemas (v4 hat .toJSON, aber emittiert ein _zod-Envelope) würden
// als komische Ghost-Properties auftauchen. Das hier ist ein bewusster
// Vertrag: was die Browser-Renderer-Pipeline liest, taucht hier auf.
// Neue Browser-needed-Fields müssen explizit erweitert werden.
//
// Aktuell projeziert (Stand 2026-04-25):
//   Entity:    { table?, fields: { type, required?, sortable?, default? } }
//   Screen:    verbatim (ScreenDefinition ist von Haus aus JSON-safe —
//              custom-screens haben keine functions, layout/columns/etc.
//              sind plain literals)
//   Nav:       verbatim (NavDefinition ist nur strings + literals)
//   Workspace: verbatim definition + getWorkspaceNavs() von der Registry
//
// Feature-Toggles: BISHER NICHT GEFILTERT. Wenn ein Feature über die
// feature-toggles-bundled-feature global deaktiviert ist, erscheint es
// trotzdem im AppSchema. Reason: die Toggle-Auflösung lebt im pipeline-
// dispatcher, nicht in der Registry, und wir haben hier keinen TenantDb-
// Kontext um sie zu lesen. TODO wenn das ein realer Use-Case wird:
// `effectiveFeatures` Argument annehmen und über alle iterations filtern.

import type { AppSchema, EntityDefinition, FeatureSchema, WorkspaceSchema } from "../ui-types";
import {
  buildConfigFeatureSchema,
  type ConfigFeatureSchema,
  SETTINGS_HUB_FEATURE,
} from "./build-config-feature-schema";
import type { Registry } from "./types/feature";
import type { FieldDefinition } from "./types/fields";

export function buildAppSchema(registry: Registry): AppSchema {
  const features: FeatureSchema[] = [];
  for (const [featureName, feature] of registry.features) {
    const navs = Object.values(feature.navs);
    const featureSchema: FeatureSchema = {
      featureName,
      entities: projectEntities(feature.entities ?? {}),
      screens: Object.values(feature.screens),
      ...(navs.length > 0 && { navs }),
    };
    features.push(featureSchema);
  }

  // Workspaces: getAllWorkspaces() liefert mit QUALIFIZIERTEN ids (das
  // schreibt die Registry beim Store-Overwrite ein). Die Browser-
  // Renderer erwartet aber kurze ids (matcht gegen URL-Segment, gegen
  // navigate({ workspaceId })). Wir gehen direkt durch `feature.workspaces`
  // — dort sind die ids noch in der Autor-Form (short) — und ziehen die
  // pre-resolved navMembers aus der Registry.
  let workspaces: WorkspaceSchema[] = [];
  for (const [featureName, feature] of registry.features) {
    for (const [shortId, definition] of Object.entries(feature.workspaces)) {
      const qualified = `${featureName}:workspace:${shortId}`;
      workspaces.push({
        definition: { ...definition, id: shortId },
        navMembers: registry.getWorkspaceNavs(qualified),
      });
    }
  }

  // Self-Populating Settings-Hub: aus den deklarierten Config-Keys mit `mask`
  // werden Screens/Navs (+ eine Workspace) abgeleitet und hier eingehängt —
  // kein manuelles r.screen/r.nav am App-Author.
  const appHadWorkspaces = workspaces.length > 0;
  const generated = buildConfigFeatureSchema(registry);
  if (generated.screens.length > 0) {
    mergeSettingsHubIntoConfigFeature(features, generated);
    // Flip-Schutz: nur für Apps die schon Workspaces nutzen. Bei einer
    // workspace-losen App bleibt app.workspaces undefined → der Renderer zeigt
    // alle Navs ungefiltert, die Hub-Navs inklusive.
    if (appHadWorkspaces) {
      const placed = placeSettingsHub(workspaces, generated);
      workspaces = placed.workspaces;
      if (placed.standalone !== undefined) workspaces.push(placed.standalone);
      warnUnplacedAudiences(placed.unplaced);
      warnDanglingAudienceRefs(placed.danglingRefs);
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
      // biome-ignore lint/suspicious/noConsole: dev-only assertion
      console.error(
        `[kumiko] buildAppSchema: Output ist nicht JSON-safe — nicht-serialisierbarer Wert bei "${offender}" (Funktions-Renderer oder Klassen-Instanz im Schema?).`,
        schema,
      );
    }
  }

  return schema;
}

// Hängt die generierten Hub-Screens/Navs an die config-FeatureSchema (qualified
// dann als config:screen:* / config:nav:*). Existiert sie noch nicht (config
// bundled-feature nicht gemountet), wird sie angelegt. find-or-create statt
// fixem Push verhindert eine zweite FeatureSchema mit demselben featureName.
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
    });
  } else {
    features[features.indexOf(existing)] = {
      ...existing,
      screens: [...existing.screens, ...generated.screens],
      navs: [...(existing.navs ?? []), ...generated.navs],
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
  // Config-Hub-Navs, die eine Workspace referenziert, die aber nie generiert
  // wurden (weder Audience noch bekanntes Kind) — z.B. `config:nav:audience-user`
  // ohne registrierte User-Scope-Config-Keys. Sonst verschwindet die Referenz
  // lautlos (silent-skip).
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
  const env = typeof process !== "undefined" ? process.env.NODE_ENV : undefined;
  // skip: dev-only authoring hint — silent in production and in tests
  // (bun:test sets NODE_ENV=test) where it would only noise up CI logs.
  if (env === "production" || env === "test") return;
  // biome-ignore lint/suspicious/noConsole: dev-only authoring hint
  console.warn(
    `[kumiko] Settings-Hub: ${unplaced.join(", ")} nicht in einer App-Workspace platziert — ` +
      `erscheint im Standalone-"Einstellungen"-Tab. Referenziere ` +
      `${unplaced.map((id) => `${SETTINGS_HUB_FEATURE}:nav:${id}`).join(", ")} ` +
      `in einer r.workspace.nav, um die Gruppe inline zu zeigen.`,
  );
}

function warnDanglingAudienceRefs(dangling: readonly string[]): void {
  // skip: no dangling refs — nothing to warn about
  if (dangling.length === 0) return;
  const env = typeof process !== "undefined" ? process.env.NODE_ENV : undefined;
  // skip: dev-only authoring hint — silent in production and in tests
  if (env === "production" || env === "test") return;
  // biome-ignore lint/suspicious/noConsole: dev-only authoring hint
  console.warn(
    `[kumiko] Settings-Hub: ${dangling
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

function projectEntities(
  entities: Readonly<Record<string, EntityDefinition>>,
): Readonly<Record<string, EntityDefinition>> {
  const out: Record<string, EntityDefinition> = {};
  for (const [name, entity] of Object.entries(entities)) {
    out[name] = projectEntity(entity);
  }
  return out;
}

// EntityDefinition ist eine Discriminated-Union an Field-Types — wir
// kennen alle JSON-safe Properties pro Field-Type. Statt jede Variante
// einzeln auszuhandeln, walken wir die Field-Map und filtern auf die
// Whitelist. Was nicht durchkommt: Server-only-runtime wie ZodValidate-
// Functions, Computed-Functions, Default-Functions.
function projectEntity(entity: EntityDefinition): EntityDefinition {
  const fieldsOut: Record<string, FieldDefinition> = {};
  for (const [fieldName, fieldDef] of Object.entries(entity.fields)) {
    fieldsOut[fieldName] = projectField(fieldDef);
  }
  // EntityDefinition akzeptiert idType/access/searchWeight als optional —
  // wir lassen die weg weil der Browser-Renderer sie nicht liest. `table`
  // schicken wir mit, falls Apps `entity.table` direkt referenzieren.
  // Kein Cast nötig: alle weggelassenen Felder sind `?`-optional.
  return {
    fields: fieldsOut,
    ...(typeof entity.table === "string" && { table: entity.table }),
  };
}

// Whitelist pro Field. `default` darf nur durch wenn Literal (string/
// number/boolean/null) — auch wenn die FieldDefinition-Types „default"
// nur als Literal typisieren, hat das Sample-Pattern
// `as unknown as EntityDefinition` Authorinnen schon Function-Defaults
// reinschmuggeln lassen. Diese Defense-in-Depth fängt sie ab BEVOR
// JSON.stringify sie in der Browser-Injection-Pipeline droppt.
//
// Cast am Exit `as FieldDefinition`: type-system-wise erfüllt unsere
// Out-Map die Discriminated-Union nur mit unverengtem `type`-String —
// der Cast bridged die Variant-Inferenz, die TS aus einem Generic
// Record nicht zurückrechnet.
function projectField(fieldDef: FieldDefinition): FieldDefinition {
  const def = fieldDef as Record<string, unknown>; // @cast-boundary schema-walk
  const out: Record<string, unknown> = {};
  if (typeof def["type"] === "string") out["type"] = def["type"];
  if (typeof def["required"] === "boolean") out["required"] = def["required"];
  if (typeof def["sortable"] === "boolean") out["sortable"] = def["sortable"];
  if (isLiteral(def["default"])) out["default"] = def["default"];
  // Select: options-Liste ist plain JSON, durchschicken.
  if (Array.isArray(def["options"])) out["options"] = def["options"];
  return out as FieldDefinition; // @cast-boundary schema-walk
}

function isLiteral(value: unknown): boolean {
  if (value === null) return true;
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean";
}
