// Client-safe Schema-Types. Wohnen in framework/ui-types statt renderer
// damit der Server (createKumikoServer / buildAppSchema) sie produzieren
// kann ohne renderer als Dependency zu ziehen. Renderer + Renderer-Web
// re-exporten dieselben Symbole — Konsumenten merken den Umzug nicht.
//
// Pattern: Types fließen "downstream" (framework → renderer → renderer-
// web), Runtime-Helpers (toAppSchema, isAppSchema) bleiben renderer-side
// weil das die Layer ist die mit den AppSchemas zur Laufzeit arbeitet.

import type { EntityDefinition } from "../engine/types/fields";
import type { NavDefinition } from "../engine/types/nav";
import type { ScreenDefinition } from "../engine/types/screen";
import type { WorkspaceDefinition } from "../engine/types/workspace";

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
