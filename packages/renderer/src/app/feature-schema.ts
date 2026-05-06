// Client-safe view of a feature: the subset the renderer needs to
// mount screens. Intentionally narrower than the server-side
// FeatureDefinition (no handlers, no hooks, no projections) so the
// file that exports a schema can be imported from the browser bundle
// without dragging in Node-only framework internals.
//
// Types wohnen in `framework/ui-types/app-schema.ts` damit der Server
// (buildAppSchema, dev-server) sie produzieren kann ohne renderer als
// Dependency zu ziehen. Hier nur Re-Export + Runtime-Helpers
// (toAppSchema, isAppSchema) die Client-Code zur Laufzeit braucht.
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
//   import { taskEntity, editScreen, ... } from "./feature-schema";
//   export const taskFeature = defineFeature("tasks", (r) => {
//     r.entity("task", taskEntity);
//     r.writeHandler(...);
//     r.screen(editScreen);
//     ...
//   });

import type {
  AppSchema,
  FeatureSchema,
  WorkspaceSchema,
} from "@cosmicdrift/kumiko-framework/ui-types";

export type { AppSchema, FeatureSchema, WorkspaceSchema };

// Normalisiert FeatureSchema → AppSchema. Idempotent für AppSchema.
// Hebt eine Feature-lokal deklarierte `workspaces`-Liste (Legacy) auf
// App-Ebene hoch, damit alle Layouts mit der neuen Form arbeiten können
// ohne dass alte clientSchemas migriert werden müssen.
export function toAppSchema(input: FeatureSchema | AppSchema): AppSchema {
  if ("features" in input) return input;
  // Old single-feature shape — wrap.
  const { workspaces, ...feature } = input;
  return {
    features: [feature],
    ...(workspaces !== undefined && { workspaces }),
  };
}

// TypeGuard — Caller die schon zur Laufzeit unterscheiden müssen
// (selten; meist reicht toAppSchema). Nicht via `"features" in x` inline
// machen — narrow'd TS dann auf den join-Typ statt die echte Differenz.
export function isAppSchema(input: FeatureSchema | AppSchema): input is AppSchema {
  return "features" in input;
}
