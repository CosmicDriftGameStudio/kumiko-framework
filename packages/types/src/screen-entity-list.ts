import type { FieldCondition } from "./fields.ts";
import type { AccessRule, AgentScreenHints } from "./handlers.ts";
import type { IconKey } from "./nav-icon.ts";
import type { FieldRenderer, PlatformComponent, ScreenNavSugar, ScreenSlots } from "./screen.ts";
import type { ActionFormRedirect } from "./screen-action-form.ts";
import type { DashboardPanelVisibility } from "./screen-dashboard.ts";
import type { EditRelatedListSection, ListEmptyStateSpec } from "./screen-entity-edit.ts";
import type { ListTableOptions } from "./screen-list-table.ts";

// --- entityList ---

// `string` shorthand when the column only needs its field name; the object
// form carries renderer / display overrides. normalizeListColumn() below
// collapses both into the object form for downstream consumers.
export type ListColumnSpec =
  | string
  | {
      readonly field: string;
      readonly renderer?: FieldRenderer;
      /** Optional header, overriding the default
       *  `<feature>:entity:<entity>:field:<field>` i18n convention. Resolved
       *  through `translate` like any header — an i18n key, or a plain literal
       *  shown verbatim if it isn't a key. Also the way to declare a *virtual*
       *  column whose `field` is NOT an entity field — a presentational column
       *  drawn entirely by a `columnRenderer` component that reads the `row`
       *  (e.g. a tag-chips cell), not a stored value. Such a column needs a
       *  label; without one it is rejected at boot as an unknown field. `field`
       *  is then just a stable column key (pick any unique slug). */
      readonly label?: string;
      /** Marks a column on a query-backed list (projectionList, relatedList,
       *  dashboard list, expandableRow) as drawn by a renderer rather than read
       *  from a row field. Without it, a query that declares an `outputSchema`
       *  must return `field`; a `label` alone does not exempt the column, since
       *  nearly every column carries one. */
      readonly virtual?: boolean;
      /** Marks this column as a reference lookup instead of a plain value —
       *  for projectionList/relatedList columns, which have no
       *  `EntityDefinition` to carry a real `reference` field type. Same
       *  target convention as `parseRefTarget`: an entity name (same
       *  feature) or `feature:entity` (cross-feature). Ignored on
       *  `entityList` columns, where the field's own declared type always
       *  wins. */
      readonly refEntity?: string;
      /** Row field on the referenced entity shown as the label (default
       *  "id"). Only meaningful together with `refEntity`. */
      readonly refLabelField?: string;
      /** Marks this column as sortable via a clickable header — for
       *  relatedList columns, which have no `EntityDefinition` field to carry
       *  `sortable` on. Ignored on `entityList` columns, where the entity
       *  field's own `sortable` flag wins. */
      readonly sortable?: boolean;
      /** Value type of a relatedList column, which has no `EntityDefinition`
       *  field to derive it from. Numeric types right-align the column and its
       *  header with tabular figures, like an entityList column of that field
       *  type. Ignored on entityList columns, where the field's own type wins. */
      readonly valueType?: "number" | "decimal" | "bigInt" | "money";
      /** Leaves the column out of the compact card layout used below the
       *  `md` breakpoint (tables keep it). For columns that only make sense
       *  next to the others, like a sort key. */
      readonly hideOnNarrow?: boolean;
      /** Start state for the column picker: the column begins hidden and the
       *  user can show it. Only valid together with `table.columnPicker`. */
      readonly hidden?: boolean;
      /** Dashboard list panels only. "bar": field holds a 0..1 fraction, drawn
       *  as bar + percent. "badge": field holds a label, drawn as a pill whose
       *  tone comes from `badgeToneField`. "datetime": field holds an ISO string or
       *  epoch ms, shown in the user's locale and time zone. Other list renderers
       *  ignore it. */
      readonly display?: ListColumnDisplay;
      /** Row field naming the badge tone; only with `display: "badge"`. */
      readonly badgeToneField?: string;
    };

export type ListColumnDisplay = "bar" | "badge" | "datetime";
export type ListBadgeTone = "positive" | "warn" | "negative" | "neutral";

// Pagination modes for entityList:
//   - "pages":     classic pager (← 1 2 ... N →) — bookmarkable via ?page=N
//                  in the URL. The server returns `total` so the pager can
//                  render "Page X of Y". Default for CRUD/admin lists.
//   - "infinite":  IntersectionObserver at the bottom — when it becomes
//                  visible it loads the next page cursor-based and appends
//                  to `rows`. No page state in the URL (scroll position is
//                  browser-owned).
//   - false:       pagination off — `executor.list()` loads everything that
//                  fits the tenant view. Sensible for small lookup/master
//                  data (≤ ~200 rows).
export type ListPaginationMode = "pages" | "infinite" | false;

// Sort state on the wire — the field name must match the entity definition
// AND be marked sortable: true. Otherwise the validator rejects at boot.
export type ListSortDir = "asc" | "desc";
export type ListSortSpec = {
  readonly field: string;
  readonly dir: ListSortDir;
};

// Screen-level filter — the author declares a fixed filter per list screen
// that is applied to every query. Use case: three buckets of the same entity
// ("Upcoming Maintenance" / "Active Maintenance" / "Past Maintenance")
// without three custom pages — the per-screen filter tells them apart.
//
// Operators (Drizzle-consistent):
//   eq/ne     → field = value | field != value
//   lt/gt     → field < value | field > value (numeric / temporal)
//   lte/gte   → field <= value | field >= value (numeric / temporal)
//   in        → field IN (...values), value must be a readonly array
//
// The field must exist in the entity AND have `filterable: true` (the boot
// validator pins both). `lt`/`gt`/`lte`/`gte` only on comparable field types
// (number/money/date/timestamp/locatedTimestamp); on
// text/boolean/select/multiSelect the validator rejects it.
//
// Security model: the filter is UX bucketing, NOT an access boundary. The
// server applies the filter from the payload — the client can omit it or
// replace it with another one. The boundaries remain the access rule +
// tenant scope; fields with a security bias (encrypted, restricted) must be
// protected there, not via the screen filter.
export type ScreenFilterOp = "eq" | "ne" | "lt" | "gt" | "lte" | "gte" | "in";
export type ScreenFilter = {
  readonly field: string;
  readonly op: ScreenFilterOp;
  readonly value: unknown;
};

/** Declarative row-field extractor — JSON-safe (no function prop, survives
 *  GET /api/schema / buildAppSchema).
 *
 *  `pick`: extracts fields 1:1. `{ pick: ["id", "version"] }` → `{ id: row.id, version: row.version }`
 *  `map`:  renames fields.      `{ map: { incidentId: "id" } }` → `{ incidentId: row.id }`
 *
 *  Limitation: computed/templated values can't be expressed this way —
 *  that logic belongs server-side in the write handler. */
export type RowFieldExtractor =
  | { readonly pick: readonly string[] }
  | { readonly map: Readonly<Record<string, string>> };

/** How a row action renders inline in the row-action column. `"button"` is a
 *  bordered button (its colour follows the action's `style`), `"link"` a text
 *  link, `"icon"` an icon-only button (needs a resolved icon, falls back to
 *  `"link"` without one). `"responsive"` is a `"button"` with icon and label
 *  from tablet width up and an icon-only button below it, the label staying the
 *  accessible name (needs a resolved icon, falls back to `"button"` without
 *  one). Unset: the renderer decides (primary action as link, the rest in the
 *  kebab menu). */
export type RowActionDisplay = "button" | "link" | "icon" | "responsive";

/** Row-action column layout. `"adaptive"` (default): primary action as link,
 *  the rest in a kebab menu — except actions with an explicit `display`, which
 *  stay inline. `"inline"`: every action inline, no kebab. */
export type RowActionMode = "adaptive" | "inline";

// RowAction — per-row button/dropdown item that triggers a write handler
// or navigates to another screen.
//
// Pattern: row-level lifecycle operations (maintenance start/cancel/
// complete, incident resolve, order ship, etc.) — things that have no
// fitting verb in a CRUD update but exist as write handlers.
//
// Discriminated union on `kind`:
//   - "writeHandler" (default): dispatches a write handler with a
//     per-row payload.
//   - "navigate": navigates to another screen, optionally with
//     URL search params from `params`. Use case: "Edit",
//     "View Audit-Log", "Open in actionForm" etc.
//   - "drawer": mounts an actionForm in a Drawer without leaving
//     the list/detail screen, prefilled from the clicked row via `params`.
//     Row-level pendant to ToolbarAction's "drawer" variant.
//   - "clientAction": runs a handler the client app registered under a
//     `<feature>:<kebab>` name (ClientFeatureDefinition.clientActions) — for
//     actions that need browser-side work or an unauthenticated endpoint.
export type RowAction =
  | RowActionWriteHandler
  | RowActionNavigate
  | RowActionDrawer
  | RowActionClientAction;

export type RowActionWriteHandler = {
  /** Default for RowActions without an explicitly set `kind` —
   *  backwards-compatible form. Can also be set explicitly. */
  readonly kind?: "writeHandler";
  /** Stable id per screen — kebab-case, unique within the action set. */
  readonly id: string;
  /** Display text (i18n key). */
  readonly label: string;
  /** Qualified name of the server handler, e.g.
   *  "publicstatus:write:maintenance:start". Dispatched via
   *  useDispatcher. */
  readonly handler: string;
  /** Declarative payload per row. Default = `{ id: row.id }`.
   *  `pick` extracts fields of the same name; `map` renames. */
  readonly payload?: RowFieldExtractor;
  /** i18n key for the confirm dialog description. When set, a modal opens
   *  before execution — the user must confirm explicitly. Together with
   *  `style: "danger"` this is the standard safety guard for destructive
   *  actions. */
  readonly confirm?: string;
  /** i18n key for the confirm button text in the dialog. Default = `label`
   *  (so "Delete" → "Delete" button in the confirm). Set it when the action
   *  has a long name ("Mark Subscription as Cancelled") and the button
   *  should be shorter ("Cancel Subscription"). */
  readonly confirmLabel?: string;
  /** Conditional visibility per row. */
  readonly visible?: FieldCondition;
  /** Visual style. "danger" renders red + forces a confirm dialog (even
   *  without an explicit `confirm` key). */
  readonly style?: "primary" | "secondary" | "danger";
  /** Overrides the id-based default icon (see ACTION_ICON_BY_ID in
   *  kumiko-renderer) — closed IconKey vocabulary into the ICONS registry
   *  (renderer/web), analogous to EditFieldSpec.icon. */
  readonly icon?: IconKey;
  /** Inline render form in the row-action column — see `RowActionDisplay`. */
  readonly display?: RowActionDisplay;
  /** Where to go after the write succeeded instead of staying on the shown
   *  record. Same forms as entityEdit `redirect`. Honored on record actions
   *  (projectionDetail header/section actions, entityEdit header/section
   *  actions); a valid `returnTo` wins under the same rule as
   *  entityEdit.redirect. Not used by list row actions. Without it, an action
   *  deleting the shown record (`<feature>:write:<entity>:delete` with that
   *  record's id) leaves to `returnTo`/the list; any other action refetches. */
  readonly redirect?: string | ActionFormRedirect;
};

export type RowActionNavigateBase = {
  readonly kind: "navigate";
  readonly id: string;
  readonly label: string;
  /** Field name whose value is embedded as entityId in the URL path
   *  (`/<workspace>/<screen>/<entityId>`). entityEdit reads the id
   *  EXCLUSIVELY from the path. Default: "id" if the target screen is an
   *  entityEdit OR if `entity` (instead of `screen`) is set. */
  readonly entityId?: string;
  /** Declarative URL search params extracted from the clicked row.
   *  Both actionForm and entityEdit-create targets read `params` as
   *  initial values (pre-filling the form). entityEdit-update does
   *  not — the existing record's values take precedence.
   *  `pick` extracts fields of the same name; `map` renames them. */
  readonly params?: RowFieldExtractor;
  /** Section id of the tab to activate on the target projectionDetail
   *  (layout.mode "tabs"); merged into the navigate search params next to
   *  returnTo. Boot validator checks the id exists on the target. */
  readonly tab?: string;
  /** Conditional visibility per row. */
  readonly visible?: FieldCondition;
  /** Visual style only — unlike the writeHandler variants, "danger" does not
   *  force a confirm dialog here: the target form is the confirmation. */
  readonly style?: "primary" | "secondary" | "danger";
  /** When true, a click on the whole row (not just the action menu) triggers
   *  this navigate action. At most one per list (the boot validator checks).
   *  Only on navigate — a row click must not trigger a (possibly destructive,
   *  unconfirmed) write, hence not on writeHandler actions. */
  readonly rowClick?: boolean;
  /** Overrides the id-based default icon (see ACTION_ICON_BY_ID in
   *  kumiko-renderer) — closed IconKey vocabulary into the ICONS registry
   *  (renderer/web), analogous to EditFieldSpec.icon. */
  readonly icon?: IconKey;
  /** Inline render form in the row-action column — see `RowActionDisplay`. */
  readonly display?: RowActionDisplay;
};

/** Exactly one of `screen` / `entity` — mutual exclusivity is type-enforced
 *  (boot validator still rejects both/neither for untyped schemas). */
export type RowActionNavigate = RowActionNavigateBase &
  (
    | {
        /** Screen id (short, unqualified). The boot validator checks that it
         *  exists in the same feature. */
        readonly screen: string;
        readonly entity?: never;
      }
    | {
        /** Entity name instead of screen id — resolves at boot time to
         *  the screen that declares `detailFor: "<entity>"` (see ObjectTarget/
         *  resolveTarget in @cosmicdrift/kumiko-renderer's nav.tsx). */
        readonly entity: string;
        readonly screen?: never;
      }
  );

export type RowActionDrawer = {
  readonly kind: "drawer";
  readonly id: string;
  readonly label: string;
  /** Short, unqualified id of an `actionForm` screen in the same feature.
   *  Boot validator rejects a missing screen and a screen whose `type`
   *  isn't `actionForm` — same check as ToolbarAction's drawer variant
   *  (see docs/plans/bundled-features-screen-standardisierung.md §2.6c). */
  readonly screen: string;
  /** Declarative prefill extracted from the clicked row. `pick` extracts
   *  fields of the same name; `map` renames them. */
  readonly params?: RowFieldExtractor;
  /** Per-row conditional visibility. */
  readonly visible?: FieldCondition;
  /** Visual style only — unlike the writeHandler variants, "danger" does not
   *  force a confirm dialog here: the target form is the confirmation. */
  readonly style?: "primary" | "secondary" | "danger";
  /** Overrides the id-based default icon (see ACTION_ICON_BY_ID in
   *  kumiko-renderer) — closed IconKey vocabulary into the ICONS registry
   *  (renderer/web), analogous to EditFieldSpec.icon. */
  readonly icon?: IconKey;
  /** Inline render form in the row-action column — see `RowActionDisplay`. */
  readonly display?: RowActionDisplay;
  /** Drawer heading (i18n key) instead of the action `label`. `{name}`
   *  placeholders resolve from the drawer prefill (`params`), formatted for
   *  display like `ActionFormScreenDefinition.summary`. */
  readonly title?: string;
  /** Line under the drawer heading (i18n key or a bare `{name}` template),
   *  resolved like `title`. */
  readonly subtitle?: string;
  /** Clicking the row opens this drawer with that row's `params`. At most one
   *  `rowClick` action (navigate or drawer) per list; rejected on
   *  projectionDetail header actions, like navigate's. */
  readonly rowClick?: boolean;
};

export type RowActionClientAction = {
  readonly kind: "clientAction";
  readonly id: string;
  readonly label: string;
  /** Registered client handler name, `<feature>:<kebab>`, e.g.
   *  "auth-email-password:request-password-reset". Resolved when the action is
   *  triggered; a name no client feature registered shows an error toast. */
  readonly action: string;
  /** Payload handed to the handler, picked from the row (or the shown record).
   *  Default `{ id: row.id }`, like a writeHandler. */
  readonly payload?: RowFieldExtractor;
  /** i18n key for the confirm dialog description. */
  readonly confirm?: string;
  /** i18n key for the confirm button, default `label`. */
  readonly confirmLabel?: string;
  /** Conditional visibility per row. */
  readonly visible?: FieldCondition;
  /** Visual style. "danger" forces a confirm dialog, like a writeHandler. */
  readonly style?: "primary" | "secondary" | "danger";
  /** Overrides the id-based default icon, see `RowActionWriteHandler.icon`. */
  readonly icon?: IconKey;
  /** Inline render form in the row-action column — see `RowActionDisplay`. */
  readonly display?: RowActionDisplay;
  /** i18n key of the toast shown after the handler reported `{ ok: true }`
   *  (default `kumiko.clientAction.success`). */
  readonly successMessage?: string;
};

// ToolbarAction — button in the list header. Three variants: navigate to
// another screen (e.g. a full-page actionForm), dispatch a handler directly
// (e.g. "Sync All" without a form), or mount an actionForm in a Drawer
// without leaving the list.
export type ToolbarAction =
  | {
      readonly kind: "navigate";
      readonly id: string;
      readonly label: string;
      /** Screen id (short, unqualified) to navigate to. */
      readonly screen: string;
      /** Section id of the tab to activate on the target projectionDetail
       *  (layout.mode "tabs"); merged into the navigate search params next to
       *  returnTo. Boot validator checks the id exists on the target. */
      readonly tab?: string;
      /** Visual style only — unlike the writeHandler variant, "danger" does
       *  not force a confirm dialog here: the target form is the
       *  confirmation. */
      readonly style?: "primary" | "secondary" | "danger";
    }
  | {
      readonly kind: "writeHandler";
      readonly id: string;
      readonly label: string;
      readonly handler: string;
      /** Static payload without row context. Default = `{}`. */
      readonly payload?: Record<string, unknown>;
      /** i18n key for the confirm dialog description. When set AND/OR
       *  style="danger": modal before execution. */
      readonly confirm?: string;
      /** i18n key for the confirm button text in the dialog. Default = `label`. */
      readonly confirmLabel?: string;
      readonly style?: "primary" | "secondary" | "danger";
    }
  | {
      readonly kind: "drawer";
      readonly id: string;
      readonly label: string;
      /** Short, unqualified id of an `actionForm` screen in the same
       *  feature. Boot validator rejects a missing screen and a screen
       *  whose `type` isn't `actionForm` — the caller decides full-page
       *  vs. drawer, not the form (see docs/plans/bundled-features-screen-
       *  standardisierung.md §2.6c). */
      readonly screen: string;
      /** Visual style only — unlike the writeHandler variant, "danger" does
       *  not force a confirm dialog here: the target form is the
       *  confirmation. */
      readonly style?: "primary" | "secondary" | "danger";
      /** Drawer heading (i18n key) instead of `label`. */
      readonly title?: string;
      /** Line under the drawer heading (i18n key). */
      readonly subtitle?: string;
    };

// relatedList-only extension of ToolbarAction:
// a relatedList section's toolbar renders inside a projectionDetail, which
// has a record to evaluate against — a plain entityList/projectionList
// toolbar does not, so `visible`/`params` live here instead of on the base
// union. `visible` uses the same FieldCondition as header actions/
// RowAction; `params` reuses RowActionNavigate's RowFieldExtractor, applied
// to the enclosing record instead of a clicked row. Every field is optional,
// so a plain ToolbarAction is already a valid RelatedListToolbarAction —
// callers pass either type without a cast.
export type RelatedListToolbarAction =
  | (Extract<ToolbarAction, { readonly kind: "navigate" }> & {
      /** Conditional visibility, evaluated against the relatedList's parent
       *  record (the "Akte"). */
      readonly visible?: FieldCondition;
      /** Declarative URL search params extracted from the parent record,
       *  prefilling the target screen. Replaces the implicit
       *  `{ [parentParam]: parentId }` default when set. */
      readonly params?: RowFieldExtractor;
    })
  | (Extract<ToolbarAction, { readonly kind: "writeHandler" }> & {
      readonly visible?: FieldCondition;
    })
  | (Extract<ToolbarAction, { readonly kind: "drawer" }> & {
      readonly visible?: FieldCondition;
    });

/** Expandable area of an `entityList` row: a relatedList of the row's record.
 *  `id` (tab id) and `countField` (tab badge) have no meaning outside a tabs
 *  layout and are therefore omitted. `kind` stays the discriminator so further
 *  expansion kinds can be added without a breaking change. */
export type EntityListExpandableRow = Omit<EditRelatedListSection, "id" | "countField" | "table">;

/** An extra choice on a facet next to the field's own options: a named
 *  bundle of values ("Running" = several statuses) or "no filter" (`values:
 *  []`, e.g. "All"). Chips only. */
export type EntityListFacetExtraOption = {
  readonly id: string;
  /** i18n key. */
  readonly label: string;
  /** Option values this choice selects; `[]` selects nothing, i.e. no filter. */
  readonly values: readonly string[];
  /** Where the chip sits relative to the field's own options. Default "start". */
  readonly position?: "start" | "end";
};

export type EntityListFacetConfig = {
  /** `"select"` (default): dropdown with checkboxes. `"chips"`: one toggle
   *  chip per option, single choice. */
  readonly display?: "select" | "chips";
  /** Chips show how many rows each option matches (other facets and the
   *  search apply). Counts come from the list query itself, one `limit: 1`
   *  count request per chip. */
  readonly showCounts?: boolean;
  /** Chips with zero matching rows are not shown. Needs counts; implies
   *  `showCounts`'s requests even when the number itself is not shown. */
  readonly hideEmpty?: boolean;
  readonly extraOptions?: readonly EntityListFacetExtraOption[];
};

export type EntityListScreenDefinition = {
  readonly id: string;
  readonly type: "entityList";
  /** Default true: the screen fills the shell content height, its body scrolls
   *  inside and the pager / action bar stays pinned. `false` restores page
   *  scroll (table grows with its rows, pager below the last row, form footer
   *  in the flow). */
  readonly fillHeight?: boolean;
  readonly nav?: ScreenNavSugar;
  readonly detailFor?: string;
  readonly description?: string;
  readonly agent?: AgentScreenHints;
  /** Screen has no nav entry by design (opened via link or navved by the
   *  app); exempts it from the nav-area boot check. */
  readonly dormant?: boolean;
  /** UI-only gate, also on direct URL access; handlers still enforce access. Unmet or failed renders `fallback`. */
  readonly visibleWhen?: DashboardPanelVisibility;
  /** Same-feature short id or cross-feature QN `<feature>:screen:<id>` shown when `visibleWhen` is unmet (default: standard notice). */
  readonly fallback?: string;
  readonly entity: string;
  /** Short screen id (same feature) the create button opens instead of the entity's default edit screen. */
  readonly createScreen?: string;
  /** Set by the role projection when `createScreen` is not reachable for the role: the renderer then shows no create button instead of falling back to the entity's edit screen. Not for app authors. */
  readonly createUnavailable?: boolean;
  /** `false` hides this list's "+ New" button (and the empty-state create CTA) while the entity's edit screen keeps its create branch for other entry points, e.g. a prefilled action. Default `true`. */
  readonly allowCreate?: boolean;
  readonly columns: readonly ListColumnSpec[];
  // Row renderer (Desktop) — when omitted, renderer draws the default table
  // from `columns`. cardRenderer fills the same role on compact layouts.
  readonly rowRenderer?: PlatformComponent;
  readonly cardRenderer?: PlatformComponent;
  /** Per-row actions, rendered as an actions column on the right.
   *  Adaptive (default, see `rowActionMode`): the primary action as a link,
   *  the rest in the kebab menu; actions with an explicit `display` stay
   *  inline. Array order is UI order. */
  readonly rowActions?: readonly RowAction[];
  /** Layout of the row-action column — see `RowActionMode`. */
  readonly rowActionMode?: RowActionMode;
  /** Toolbar actions (list header). "Open Incident", "Schedule Maintenance"
   *  etc. — next to "+ New" if present. Array order = UI order,
   *  primary-style links. */
  readonly toolbarActions?: readonly ToolbarAction[];
  /** Expandable area under each row: a relatedList of the row's record
   *  (parentId = the row's `id`). Rows get a toggle button; several rows can
   *  be open at once. Its own row actions run against the sub-list rows, and
   *  a successful write also reloads this list. */
  readonly expandableRow?: EntityListExpandableRow;
  /** Server-side filter, fixed on the screen — three buckets of the same
   *  entity without custom pages (e.g. "Upcoming" / "Active" / "Past"
   *  Maintenance). The user-side q search runs ON the filtered set on top.
   *  The boot validator pins that the field exists in the entity. */
  readonly filter?: ScreenFilter;
  // Pagination mode (default "pages"). Determines the UI (pager vs scroll
  // sentinel) and whether the server has to return `total`.
  readonly pagination?: ListPaginationMode;
  // Page size. Default 50 — a good compromise between "lots visible" and
  // "DB responds quickly". Apps with expensive reads (joins, computed
  // fields) go lower; power-user lists (e.g. internal analytics) go
  // higher.
  readonly pageSize?: number;
  /** Opt-in table behaviour: remembered state, reset, column picker, density. */
  readonly table?: ListTableOptions;
  // Default sort on first mount. If the URL param `?sort=…` is set, that
  // wins; otherwise RenderList uses this default. `field` must be
  // sortable: true in the entity — the boot validator pins that.
  readonly defaultSort?: ListSortSpec;
  /** Initial facet selection, per filterable field: option values (string
   *  facets) or a boolean. Applies only while the URL carries no value for
   *  that field, so a link or the user's own choice wins; picking "no filter"
   *  (an `extraOptions` entry with `values: []`, or clearing the facet) is
   *  remembered in the URL and is not overridden again. */
  readonly defaultFilters?: Readonly<Record<string, readonly string[] | boolean>>;
  /** Per-facet display options for the entity's `filterable` fields, keyed by
   *  field name. `false` hides the facet's control (its filter stays usable
   *  through `defaultFilters` and the URL). Fields without an entry keep the
   *  default dropdown. */
  readonly facets?: Readonly<Record<string, EntityListFacetConfig | false>>;
  /** Replaces the default empty-list title/hint; the create button stays when the list can create. */
  readonly emptyState?: ListEmptyStateSpec;
  /** i18n key for the primary create button label (default `kumiko.actions.create`). */
  readonly createLabel?: string;
  /** i18n key for the search field placeholder (default `kumiko.list.search-placeholder`). */
  readonly searchPlaceholder?: string;
  // Search toolbar in the UI on/off. Server search ALWAYS goes through the
  // SearchAdapter (Meilisearch) — no DB-ILIKE drift. Default true if the
  // entity has searchable fields, otherwise false.
  readonly searchable?: boolean;
  readonly slots?: ScreenSlots;
  readonly access?: AccessRule;
};
