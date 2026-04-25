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
import type { Registry } from "./types/feature";

export function buildAppSchema(registry: Registry): AppSchema {
  const features: FeatureSchema[] = [];
  for (const [featureName, feature] of registry.features) {
    const navs = Object.values(feature.navs);
    const featureSchema: FeatureSchema = {
      featureName,
      entities: projectEntities(feature.entities),
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
  const workspaces: WorkspaceSchema[] = [];
  for (const [featureName, feature] of registry.features) {
    for (const [shortId, definition] of Object.entries(feature.workspaces)) {
      const qualified = `${featureName}:workspace:${shortId}`;
      workspaces.push({
        definition: { ...definition, id: shortId },
        navMembers: registry.getWorkspaceNavs(qualified),
      });
    }
  }

  return {
    features,
    ...(workspaces.length > 0 && { workspaces }),
  };
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
  const fieldsIn = entity.fields as Readonly<Record<string, unknown>>;
  const fieldsOut: Record<string, unknown> = {};
  for (const [fieldName, fieldDef] of Object.entries(fieldsIn)) {
    fieldsOut[fieldName] = projectField(fieldDef);
  }
  // EntityDefinition akzeptiert eine Reihe optionaler Felder (idType,
  // table, ...), aber der Browser-Renderer liest nur fields[]. Wir
  // schicken `table` mit weil Apps die mit `entity.table` direkt
  // arbeiten könnten — kostet nichts und beugt Backwards-Compat-Brüche
  // vor.
  const projected: Record<string, unknown> = {
    fields: fieldsOut,
  };
  const table = (entity as { table?: unknown }).table;
  if (typeof table === "string") projected["table"] = table;
  return projected as unknown as EntityDefinition;
}

// Whitelist pro Field. `default` darf nur durch wenn Literal (string/
// number/boolean/null) — Function-Defaults gehören zur Server-Logik
// (z.B. `() => crypto.randomUUID()`) und dürfen den Browser nicht
// erreichen, der hat dafür keine Reproduktion.
function projectField(fieldDef: unknown): unknown {
  if (typeof fieldDef !== "object" || fieldDef === null) return {};
  const def = fieldDef as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof def["type"] === "string") out["type"] = def["type"];
  if (typeof def["required"] === "boolean") out["required"] = def["required"];
  if (typeof def["sortable"] === "boolean") out["sortable"] = def["sortable"];
  if (isLiteral(def["default"])) out["default"] = def["default"];
  // Select: options-Liste ist plain JSON, durchschicken.
  if (Array.isArray(def["options"])) out["options"] = def["options"];
  return out;
}

function isLiteral(value: unknown): boolean {
  if (value === null) return true;
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean";
}
