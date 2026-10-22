// Client-safe view of a feature: the subset the renderer needs to
// mount screens. Intentionally narrower than the server-side
// FeatureDefinition (no handlers, no hooks, no projections) so the
// file that exports a schema can be imported from the browser bundle
// without dragging in Node-only framework internals.
//
// Types live in `framework/ui-types/app-schema.ts` so the server
// (buildAppSchema, dev-server) can produce them without pulling in
// renderer as a dependency. Only re-exports and runtime helpers
// (toAppSchema, isAppSchema) needed by client code at runtime belong here.
//
// Typical layout on the feature author's side:
//
//   // feature-schema.ts  (imported by client AND server)
//   export const taskEntity = createEntity({ ... });
//   export const editScreen: EntityEditScreenDefinition = { ... };
//   export const clientSchema: FeatureSchema = {
//     featureName: "tasks",
//     entities: { task: taskEntity },
//     screens: [editScreen, ...],
//   };
//
//   // feature.ts  (server-only — imports defineFeature)
//   import { taskEntity, editScreen, ... } from "./feature-schema.js";
//   export const taskFeature = defineFeature("tasks", (r) => {
//     r.entity({ name: "task", ...taskEntity });
//     r.writeHandler(...);
//     r.screen(editScreen);
//     ...
//   });

import type {
  AppSchema,
  FeatureSchema,
  QualifiedContentCollection,
  WorkspaceSchema,
} from "@cosmicdrift/kumiko-framework/ui-types";

export type { AppSchema, FeatureSchema, QualifiedContentCollection, WorkspaceSchema };

// Normalizes FeatureSchema → AppSchema and is idempotent for AppSchema.
// Promotes a feature-local `workspaces` list (legacy) to the app level
// so all layouts can use the new form without requiring old clientSchemas
// to be migrated.
export function toAppSchema(input: FeatureSchema | AppSchema): AppSchema {
  if ("features" in input) return input;
  // Old single-feature shape — wrap.
  const { workspaces, ...feature } = input;
  return {
    features: [feature],
    ...(workspaces !== undefined && { workspaces }),
  };
}

// Type guard for callers that need to distinguish the types at runtime
// (rare; toAppSchema is usually sufficient). Do not use `"features" in x`
// inline: TS then narrows to the join type instead of the actual distinction.
export function isAppSchema(input: FeatureSchema | AppSchema): input is AppSchema {
  return "features" in input;
}
