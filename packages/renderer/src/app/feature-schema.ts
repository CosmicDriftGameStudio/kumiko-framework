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
  // Workspaces — persona-/role-scoped UI surfaces. Each entry carries
  // the resolved nav-membership pre-merged from r.workspace.nav AND
  // r.nav.workspaces (the engine's getWorkspaceNavs() output) so the
  // browser bundle doesn't need to redo the merge. Omitted when the app
  // doesn't use workspaces — WorkspaceShell falls back to all-navs.
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
