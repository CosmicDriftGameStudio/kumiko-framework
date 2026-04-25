import type {
  EntityDefinition,
  NavDefinition,
  ScreenDefinition,
  WorkspaceDefinition,
} from "@kumiko/framework/ui-types";

// Client-safe view of a feature: the subset the renderer needs to
// mount screens. Intentionally narrower than the server-side
// FeatureDefinition (no handlers, no hooks, no projections) so the
// file that exports a schema can be imported from the browser bundle
// without dragging in Node-only framework internals.
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
//
// The duplication at the boundary (listing screens in both the schema
// AND the feature registrar) is the price of splitting client vs
// server concerns without requiring explicit markers on each
// registrar call. Later: a `defineFeature` tree-shakeable enough that
// the client can safely import just the schema parts directly.

export type FeatureSchema = {
  readonly featureName: string;
  readonly entities: Readonly<Record<string, EntityDefinition>>;
  readonly screens: readonly ScreenDefinition[];
  // Flat list; resolveNavigation builds the tree at render-time from
  // the registry's indexes. Omitted when the app has no top-level nav.
  readonly navs?: readonly NavDefinition[];
  // Workspaces — Legacy-Slot für single-feature-Apps. Bevorzugt liegt
  // workspaces auf der AppSchema-Ebene weil ihre navMembers regelmäßig
  // Cross-Feature-Navs referenzieren (siehe AppSchema-Doc). Hier als
  // Fallback erhalten damit alte clientSchema-Files (vor AppSchema)
  // ohne Migration weiter laufen — toAppSchema() hebt die Liste hoch.
  readonly workspaces?: readonly WorkspaceSchema[];
};

// Per-workspace projection of the engine's WorkspaceDefinition + the
// pre-resolved member nav QNs. The shell renders the switcher from
// `definition` and filters the nav tree using `navMembers`.
export type WorkspaceSchema = {
  readonly definition: WorkspaceDefinition;
  // Nav QNs that belong to this workspace, in the order the engine
  // resolved them (explicit r.workspace.nav first, then nav-self-assigned
  // entries — deduped). Empty when no nav has been assigned.
  readonly navMembers: readonly string[];
};

// App-level schema. Bündelt ein oder mehrere FeatureSchemas + die App-
// weiten Workspaces. Sinn der Trennung: Workspaces aggregieren über
// Feature-Grenzen (admin-Workspace zeigt navs aus mehreren Features), und
// die navMembers-Liste enthält voll qualifizierte QNs die der Browser
// gegen die jeweilige feature-spezifische `navs`-Liste auflöst.
//
// Backwards-Compat: createKumikoApp + die Layouts (DefaultAppShell,
// WorkspaceShell) akzeptieren beides — `FeatureSchema` (single-feature,
// historisch) und `AppSchema` (multi-feature). Ein `toAppSchema(input)`-
// Adapter normalisiert intern, sodass die ganze inneren Renderer-Pipeline
// nur noch AppSchema kennt.
export type AppSchema = {
  readonly features: readonly FeatureSchema[];
  // Optional — Apps ohne Workspaces nutzen DefaultAppShell und sehen
  // schlicht die NavTree aller Features.
  readonly workspaces?: readonly WorkspaceSchema[];
};

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
