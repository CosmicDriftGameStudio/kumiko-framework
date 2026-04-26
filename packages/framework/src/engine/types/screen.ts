import type { AccessRule } from "./handlers";

// Screen definitions describe how a feature surfaces data to the user.
// Pure data — the engine stores these verbatim and ui-core / the renderer
// packages decide what to do with them. The framework must not import
// React / react-native from here; renderer components stay opaque so
// `engine/` imports don't pull the whole UI toolchain into every bundle.
//
// Note on `id`: feature authors write the short form ("product-list"); the
// registry overwrites `id` with the qualified name ("shop:screen:product-list")
// in its stored copies. Callers of `registry.getScreen(qn)` /
// `getAllScreens()` / `getScreensByEntity(...)` always see the qualified id.
// `feature.screens[shortId]` on the unregistered FeatureDefinition keeps
// the short form.

// A per-platform component pair — used anywhere a feature attaches a
// rendered component (screens, slots, routes, field renderers, future
// r.uiComponent). Both fields are `unknown` so the engine doesn't depend
// on React types; ui-core resolves the correct platform at mount-time.
// Framework code only checks structural presence.
export type PlatformComponent = {
  readonly react?: unknown;
  readonly native?: unknown;
};

// Level-2 field renderer (ui-architecture.md §Renderer Customization):
//   - PlatformComponent → platform-specific component from the same feature
//   - string            → cross-feature QN reference (resolved by the renderer)
//   - function          → inline value formatter (e.g. `v => `${v} €``)
export type FieldRenderer = PlatformComponent | string | ((value: unknown) => string);

// Conditional field-state evaluator. `data` is the current form row and
// `ctx` carries user / session info — the form-controller in ui-core passes
// both at evaluation time. Engine-side defaults are `unknown` because the
// framework has nothing to assert about the shapes; feature code can narrow
// them by passing type args (e.g. `FieldCondition<OrderRow>`) to skip the
// cast at call sites.
export type FieldCondition<TData = unknown, TCtx = unknown> = (data: TData, ctx: TCtx) => boolean;

// --- entityList ---

// `string` shorthand when the column only needs its field name; the object
// form carries renderer / display overrides. normalizeListColumn() below
// collapses both into the object form for downstream consumers.
export type ListColumnSpec =
  | string
  | {
      readonly field: string;
      readonly renderer?: FieldRenderer;
    };

// Pagination-Modi für entityList:
//   - "pages":     klassischer Pager (← 1 2 ... N →) — bookmarkable
//                  via ?page=N in der URL. Server liefert `total`
//                  damit der Pager "Page X of Y" rendern kann.
//                  Default für CRUD-/Admin-Listen.
//   - "infinite":  IntersectionObserver am Bottom — beim Sichtbar
//                  werden lädt cursor-basiert die nächste Page und
//                  appended an `rows`. Kein page-State in URL (Scroll-
//                  Position ist Browser-eigen).
//   - false:       Pagination aus — `executor.list()` lädt alles
//                  was zur Tenant-Sicht passt. Sinnvoll für kleine
//                  Lookup-/Master-Daten (≤ ~200 Rows).
export type ListPaginationMode = "pages" | "infinite" | false;

// Sort-State auf der Wire — Field-Name muss zur Entity-Definition
// passen UND als sortable: true markiert sein. Validator lehnt sonst
// beim Boot ab.
export type ListSortDir = "asc" | "desc";
export type ListSortSpec = {
  readonly field: string;
  readonly dir: ListSortDir;
};

export type EntityListScreenDefinition = {
  readonly id: string;
  readonly type: "entityList";
  readonly entity: string;
  readonly columns: readonly ListColumnSpec[];
  // Row renderer (Desktop) — when omitted, renderer draws the default table
  // from `columns`. cardRenderer fills the same role on compact layouts.
  readonly rowRenderer?: PlatformComponent;
  readonly cardRenderer?: PlatformComponent;
  // Pagination-Modus (Default "pages"). Bestimmt UI (Pager vs Scroll-
  // Sentinel) und ob der Server `total` mitliefern muss.
  readonly pagination?: ListPaginationMode;
  // Page-Größe. Default 50 — guter Kompromiss zwischen "viel sichtbar"
  // und "DB liefert schnell". Apps mit teurem Read (Joins, Computed-
  // Fields) gehen runter; Power-User-Listen (z.B. internal Analytics)
  // gehen hoch.
  readonly pageSize?: number;
  // Default-Sortierung beim Erst-Mount. Wenn URL-Param `?sort=…`
  // gesetzt ist, gewinnt der; sonst nutzt RenderList diesen Default.
  // `field` muss in der Entity sortable: true sein — Boot-Validator
  // pinnt das.
  readonly defaultSort?: ListSortSpec;
  // Search-Toolbar im UI an/aus. Server-Search geht IMMER über den
  // SearchAdapter (Meilisearch) — kein DB-ILIKE-Drift. Default true
  // wenn die Entity searchable Felder hat, sonst false.
  readonly searchable?: boolean;
  readonly slots?: ScreenSlots;
  readonly access?: AccessRule;
};

// --- entityEdit ---

// camelCase `readOnly` instead of the spec's lowercase `readonly`: TS's
// `readonly` modifier on the same line would make the declaration read
// `readonly readonly?: FieldCondition`, which is legal but a real lese-knick.
// Mirrors React's `readOnly` prop so the ergonomic cost of the divergence
// from ui-architecture.md is minimal.
export type EditFieldSpec =
  | string
  | {
      readonly field: string;
      readonly span?: number;
      readonly visible?: FieldCondition;
      readonly readOnly?: FieldCondition;
      readonly required?: FieldCondition;
      readonly renderer?: FieldRenderer;
    };

export type EditSectionSpec = {
  readonly title: string;
  readonly columns?: number;
  readonly fields: readonly EditFieldSpec[];
};

export type EditLayout = {
  readonly sections: readonly EditSectionSpec[];
};

export type EntityEditScreenDefinition = {
  readonly id: string;
  readonly type: "entityEdit";
  readonly entity: string;
  readonly layout: EditLayout;
  readonly slots?: ScreenSlots;
  readonly access?: AccessRule;
};

// --- custom ---

// Sub-route declared by a custom screen (Expo Router / URL-routing use).
// `path` is the route-segment appended to the screen's own path; the
// framework owns the outer routing. Components stay opaque.
export type CustomScreenRoute = {
  readonly path: string;
  readonly component: PlatformComponent;
};

export type CustomScreenDefinition = {
  readonly id: string;
  readonly type: "custom";
  readonly renderer: PlatformComponent;
  readonly routes?: readonly CustomScreenRoute[];
  readonly access?: AccessRule;
};

// --- shared slots (Level 4 from ui-architecture.md) ---

export type ScreenSlots = {
  readonly header?: PlatformComponent;
  readonly beforeForm?: PlatformComponent;
  readonly afterForm?: PlatformComponent;
  readonly sidebar?: PlatformComponent;
  readonly footer?: PlatformComponent;
  readonly toolbar?: PlatformComponent;
};

// --- discriminated union ---

export type ScreenDefinition =
  | EntityListScreenDefinition
  | EntityEditScreenDefinition
  | CustomScreenDefinition;

// Collapse the string-shorthand into the object form. Both the boot-validator
// and (later) ui-core's view-model builder iterate over fields/columns — the
// helper keeps that loop from growing two branches everywhere.
export function normalizeListColumn(c: ListColumnSpec): Exclude<ListColumnSpec, string> {
  return typeof c === "string" ? { field: c } : c;
}

export function normalizeEditField(f: EditFieldSpec): Exclude<EditFieldSpec, string> {
  return typeof f === "string" ? { field: f } : f;
}
