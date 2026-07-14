// Pattern-Library — concrete FormSchema entries for every FeaturePattern
// kind. Centralised here so the Designer (C5/C6), the AI-Builder (L2),
// and the MCP-Server (L9) share one source-of-truth for "how does this
// pattern look as a form?".
//
// **Updating contract:** when a new pattern-kind gets a parser/renderer
// extension, add a matching entry here. The exhaustiveness test
// (pattern-library.test.ts) catches missing kinds at CI time.
//
// **Path stability:** every `path` references a property of the parsed
// FeaturePattern shape. When the pattern type changes (new field added
// to e.g. EntityPattern.definition), update both the renderer in
// render.ts AND the library here — paths are part of the public API
// the Designer/LLM relies on.

import type { FeaturePatternKind } from "../feature-ast/patterns";
import {
  authClaimsSchema,
  defineEventSchema,
  entityHookSchema,
  eventMigrationSchema,
  hookSchema,
  httpRouteSchema,
  jobSchema,
  multiStreamProjectionSchema,
  notificationSchema,
  projectionSchema,
  queryHandlerSchema,
  screenSchema,
  writeHandlerSchema,
} from "./mixed-schemas";
import {
  envSchemaSchema,
  exposesApiSchema,
  extendsRegistrarSchema,
  treeActionsSchema,
  unknownSchema,
  usesApiSchema,
} from "./opaque-schemas";
import {
  claimKeySchema,
  configSchema,
  describeSchema,
  entitySchema,
  metricSchema,
  navSchema,
  optionalRequiresSchema,
  readsConfigSchema,
  referenceDataSchema,
  relationSchema,
  requiresSchema,
  secretSchema,
  systemScopeSchema,
  toggleableSchema,
  translationsSchema,
  uiHintsSchema,
  useExtensionSchema,
  workspaceSchema,
} from "./static-schemas";
import type { PatternCategory, PatternFormSchema } from "./types";

export const PATTERN_LIBRARY: Readonly<Record<FeaturePatternKind, PatternFormSchema>> = {
  requires: requiresSchema,
  optionalRequires: optionalRequiresSchema,
  readsConfig: readsConfigSchema,
  systemScope: systemScopeSchema,
  toggleable: toggleableSchema,
  describe: describeSchema,
  uiHints: uiHintsSchema,
  entity: entitySchema,
  relation: relationSchema,
  nav: navSchema,
  workspace: workspaceSchema,
  config: configSchema,
  translations: translationsSchema,
  metric: metricSchema,
  secret: secretSchema,
  claimKey: claimKeySchema,
  referenceData: referenceDataSchema,
  useExtension: useExtensionSchema,
  screen: screenSchema,
  writeHandler: writeHandlerSchema,
  queryHandler: queryHandlerSchema,
  hook: hookSchema,
  entityHook: entityHookSchema,
  job: jobSchema,
  notification: notificationSchema,
  authClaims: authClaimsSchema,
  httpRoute: httpRouteSchema,
  projection: projectionSchema,
  multiStreamProjection: multiStreamProjectionSchema,
  defineEvent: defineEventSchema,
  eventMigration: eventMigrationSchema,
  extendsRegistrar: extendsRegistrarSchema,
  usesApi: usesApiSchema,
  exposesApi: exposesApiSchema,
  treeActions: treeActionsSchema,
  envSchema: envSchemaSchema,
  unknown: unknownSchema,
} satisfies Readonly<Record<FeaturePatternKind, PatternFormSchema>>;

/**
 * Lookup helper — convenience over `PATTERN_LIBRARY[kind]`. Throws when
 * the kind is missing from the catalogue, which is a programming error
 * the exhaustiveness test should catch at CI time.
 */
export function getPatternSchema(kind: FeaturePatternKind): PatternFormSchema {
  const schema = PATTERN_LIBRARY[kind];
  if (!schema) {
    throw new Error(`pattern-library: no schema for kind "${kind}"`);
  }
  return schema;
}

/**
 * Group the library by category — helper for the Designer's "add new
 * pattern" panel.
 */
export function groupByCategory(): Readonly<Record<PatternCategory, readonly PatternFormSchema[]>> {
  const groups: Record<PatternCategory, PatternFormSchema[]> = {
    data: [],
    behaviour: [],
    ui: [],
    meta: [],
    background: [],
    "cross-cutting": [],
    advanced: [],
  };
  for (const schema of Object.values(PATTERN_LIBRARY)) {
    groups[schema.category].push(schema);
  }
  for (const list of Object.values(groups)) {
    list.sort((a, b) => a.label.en.localeCompare(b.label.en));
  }
  return groups;
}
