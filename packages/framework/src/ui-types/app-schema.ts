// Client-safe schema types. Live in framework/ui-types rather than renderer
// so the server (createKumikoServer / buildAppSchema) can produce them
// without pulling in renderer as a dependency. Renderer and Renderer-Web
// re-export the same symbols, so consumers do not notice the move.
//
// Pattern: types flow "downstream" (framework → renderer → renderer-
// web); runtime helpers (toAppSchema, isAppSchema) remain renderer-side
// because that is the layer that works with AppSchemas at runtime.

import type { TranslationKeys } from "../engine/types/config.ts";
import type { EntityDefinition } from "../engine/types/fields.ts";
import type { ContentCollectionDefinition, NavDefinition } from "../engine/types/nav.ts";
import type { ScreenDefinition } from "../engine/types/screen.ts";
import type { WorkspaceDefinition } from "../engine/types/workspace.ts";

export type FeatureSchema = {
  readonly featureName: string;
  readonly entities: Readonly<Record<string, EntityDefinition>>;
  readonly screens: readonly ScreenDefinition[];
  // Flat list; resolveNavigation builds the tree at render-time from
  // the registry's indexes. Omitted when the app has no top-level nav.
  readonly navs?: readonly NavDefinition[];
  // Content collections declared via r.contentCollection(), each with its nav
  // QN already qualified. The matching nav entries are in `navs` like any
  // other; this list only carries what a NavDefinition can't express — which
  // template-resource `kind` the node lists — so the client can build one
  // tree provider per collection. Omitted when a feature declares none.
  readonly contentCollections?: readonly QualifiedContentCollection[];
  // Server-authored `r.translations({ keys })`, projected verbatim — byte-
  // identical keys, NOT re-prefixed with featureName (unlike the registry's
  // internal mergedTranslations, which double-prefixes features that
  // already qualify their own keys — see registry-ingest.ts populate
  // Translations). Nav/screen labels resolve these keys directly via
  // `t(label)`, so shipping anything other than the raw authored string
  // would break the lookup. Omitted when a feature declares none. Without
  // this, nav labels only resolved when an app ALSO duplicated the
  // key in `web/i18n.ts` — most bundled features never did, so labels
  // rendered as raw i18n keys in the shell.
  readonly translations?: TranslationKeys;
  // Workspaces — legacy slot for single-feature apps. They preferably live
  // at the AppSchema level because their navMembers regularly reference
  // cross-feature navs (see the AppSchema docs). Retained here as a
  // fallback so old clientSchema files (from before AppSchema) continue
  // working without migration — toAppSchema() lifts the list up.
  readonly workspaces?: readonly WorkspaceSchema[];
  // True only when the server confirmed at boot that no SearchAdapter is
  // wired on context.searchAdapter — mirrors the global (not per-entity)
  // check behind api/server.ts's boot warning. Duplicated
  // identically across every feature purely so it threads through the
  // existing per-feature prop chain into screen renderers (kumiko-screen.tsx)
  // without a separate app-level plumbing path. Omitted for schemas that
  // don't flow through buildAppSchema() (hand-authored fixtures, legacy
  // toAppSchema()) — treated as "not missing" so search bars keep rendering
  // exactly as before this flag existed.
  readonly searchAdapterMissing?: boolean;
  // Query QN (as passed to dispatcher.query) -> entities its handler declares via
  // liveEntities, for useQuery({ live: true }); only handlers of this feature
  // with a non-empty list. Per feature so a tenant feature toggle strips it.
  readonly queryLiveEntities?: Readonly<Record<string, readonly string[]>>;
};

// A content collection as it reaches the client: the declaration plus the
// already-qualified nav QN, so consumers don't rebuild "<feature>:nav:<id>".
export type QualifiedContentCollection = ContentCollectionDefinition & {
  readonly navQn: string;
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

// App-level schema. Bundles one or more FeatureSchemas with the app-wide
// workspaces. The separation matters because workspaces aggregate across
// feature boundaries (the admin workspace shows navs from multiple features),
// and navMembers contains fully qualified QNs that the browser resolves
// against each feature's `navs` list.
//
// Backwards compatibility: createKumikoApp and the layouts (DefaultAppShell,
// WorkspaceShell) accept both `FeatureSchema` (single-feature, historical)
// and `AppSchema` (multi-feature). A `toAppSchema(input)` adapter normalizes
// them internally, so the entire inner renderer pipeline only knows AppSchema.
export type AppSchema = {
  readonly features: readonly FeatureSchema[];
  // Optional — apps without workspaces use DefaultAppShell and simply see
  // the nav tree of all features.
  readonly workspaces?: readonly WorkspaceSchema[];
};
