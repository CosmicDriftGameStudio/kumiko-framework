import type { SelectOptionTone } from "./fields.ts";
import type { AccessRule, AgentScreenHints } from "./handlers.ts";
import type { PlatformComponent, ScreenNavSugar, ScreenSlots } from "./screen.ts";
import type { DashboardPanelVisibility } from "./screen-dashboard.ts";
import type { EditLayout, ListEmptyStateSpec } from "./screen-entity-edit.ts";
import type {
  ListColumnSpec,
  ListPaginationMode,
  ListSortSpec,
  RowAction,
  RowActionMode,
  RowFieldExtractor,
  ScreenFilter,
  ToolbarAction,
} from "./screen-entity-list.ts";
import type { ListBulkAction } from "./screen-list-bulk.ts";
import type { ListTableOptions } from "./screen-list-table.ts";

// --- projectionList ---

// Like entityList, but bound to an EXPLICIT query instead of an entity. The
// list-query is taken verbatim from `query` (a fully qualified QN like
// "ledger:query:schedule:list") — NOT derived from the screen's own feature —
// so a screen can render any read-projection, including one owned by a
// different feature (the entityList feature-local resolution can't). Columns
// carry their own labels (no entity to derive field-labels from); there is no
// auto create-navigation (a projection isn't an editable entity list). Row
// interaction is explicit via `rowActions`. The query must return the same
// paged envelope as an entity list-query: `{ rows, nextCursor, total? }`.
// User-toggleable facet dropdown on a projectionList screen.
// entityList derives the same UI from `filterable: true` entity fields plus
// the `<feature>:entity:<entity>:field:<field>:option:<value>` i18n
// convention. Labels here (`label`, `options[].label`, `trueLabel`/
// `falseLabel`) are i18n keys resolved via `translate()` with passthrough
// for unknown keys — not raw display strings. Sent to the server
// as `{field, op:"in", value}` in `payload.filters`, ANDed with `filter`.
// Exception: "dateRange" sends its bounds as the two top-level payload keys
// named in `params`, not as a `filters` entry.
export type ListFacetSpec =
  | {
      readonly field: string;
      readonly type: "select";
      readonly label: string;
      readonly options: readonly { readonly value: string; readonly label: string }[];
    }
  | {
      readonly field: string;
      readonly type: "boolean";
      readonly label: string;
      readonly trueLabel: string;
      readonly falseLabel: string;
    }
  | {
      readonly field: string;
      readonly type: "reference";
      readonly label: string;
      /** Entity name (same feature) or `feature:entity` (cross-feature), same
       *  convention as `ListColumnSpec.refEntity`. Options load at render time. */
      readonly entity: string;
      /** Row field on the referenced entity shown as the option label
       *  (default "id"). */
      readonly labelField?: string;
    }
  | {
      /** Declarative only — the date field the range narrows. It is NOT sent
       *  to the server (the bounds go under `params`); it namespaces the
       *  facet's URL keys and tells a reading agent which column this list
       *  is time-rangeable on. */
      readonly field: string;
      readonly type: "dateRange";
      readonly label: string;
      /** Query-payload keys the chosen bounds are sent under as ISO instants.
       *  Explicit rather than a `from`/`to` convention — a query is free to
       *  name its time bounds anything, and the boot-validator checks these
       *  keys against the handler's Zod schema. */
      readonly params: { readonly from: string; readonly to: string };
    };

export type ProjectionListScreenDefinition = {
  readonly id: string;
  readonly type: "projectionList";
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
  readonly query: string;
  readonly columns: readonly ListColumnSpec[];
  readonly rowRenderer?: PlatformComponent;
  readonly cardRenderer?: PlatformComponent;
  readonly rowActions?: readonly RowAction[];
  /** Layout of the row-action column — see `RowActionMode`. */
  readonly rowActionMode?: RowActionMode;
  /** Bulk actions over checkbox-selected rows, each pointing at a writeHandler row action. Adds a checkbox column and a selection bar; without it the list has no checkboxes. */
  readonly bulkActions?: readonly ListBulkAction[];
  readonly toolbarActions?: readonly ToolbarAction[];
  readonly pagination?: ListPaginationMode;
  readonly pageSize?: number;
  /** Opt-in table behaviour: remembered state, reset, column picker, density. */
  readonly table?: ListTableOptions;
  readonly defaultSort?: ListSortSpec;
  /** Replaces the default empty-list title/hint; the create button stays when the list can create. */
  readonly emptyState?: ListEmptyStateSpec;
  /** i18n key for the primary create button label (default `kumiko.actions.create`). */
  readonly createLabel?: string;
  /** i18n key for the search field placeholder (default `kumiko.list.search-placeholder`). */
  readonly searchPlaceholder?: string;
  readonly searchable?: boolean;
  /** Derived by buildAppSchema from the query handler's Zod schema (`sort`
   *  param present). Same type serves author and wire schema (no separate
   *  client-facing screen type exists), so this stays structurally
   *  writable — validateProjectionListScreens rejects any hand-authored
   *  value at boot. */
  readonly sortable?: boolean;
  /** Derived by buildAppSchema from the query handler's Zod schema (`cursor`
   *  or `offset` param present). See `sortable` doc for why this is
   *  boot-enforced rather than type-enforced. */
  readonly paginated?: boolean;
  /** Server-side filter, fixed on the screen — see `ScreenFilter` doc above
   *  (entityList). Field existence can't be checked without an entity; the
   *  boot-validator only checks structure (`op:"in"` ⇒ array value). */
  readonly filter?: ScreenFilter;
  /** User-toggleable facet dropdowns — see `ListFacetSpec` doc. `field`
   *  must be a declared column, except for `type: "reference"`: it filters
   *  by id through the bound query's `filters` and needs a registered
   *  `entity` instead. The bound query handler must accept `filters` in its
   *  Zod schema — the boot-validator checks both. A
   *  "dateRange" facet instead needs its two `params` keys in that schema;
   *  it sends no `filters` entry. */
  readonly facets?: readonly ListFacetSpec[];
  readonly slots?: ScreenSlots;
  readonly access?: AccessRule;
};

// --- projectionDetail ---

// Read-only counterpart to projectionList — a single-row inspector bound to
// an EXPLICIT query instead of an entity (`entityEdit` requires `r.entity`,
// which a direct-write/projection read-model like `jobs`/`sessions` doesn't
// have). There is no write path: the renderer forces every field
// readOnly structurally (not just by convention — see
// renderer/projection-detail-shim.ts), so no `<entity>:write:...:update`
// command is ever constructed. `idParam` names the query-payload key the
// route's row-id is passed under; defaults to "id", but a query handler
// owned by a different feature may already use a domain-specific param name
// (e.g. jobs' `detailQuery` expects `runId`) — this lets the primitive bind
// to it without forcing a handler rename. Extension sections aren't
// supported (no entity for them to persist against); the boot-validator
// rejects them. `relatedList` sections ARE supported — they run their own
// query against the displayed record's id, independent of the entity gap
// above.
export type RecordHeaderSubtitlePart =
  | string
  | { readonly field: string; readonly navigate?: MetricNavigate };

export type RecordHeaderSpec = {
  readonly title: string;
  /** Field name, or several parts (field name or `{ field, navigate }`)
   *  joined by a separator; parts with an empty value are dropped. */
  readonly subtitle?: string | readonly RecordHeaderSubtitlePart[];
  readonly status?: string;
  /** Record field holding an absolute http(s) URL. When present and the
   *  field's value is such a URL, the subtitle renders as an external link
   *  (`target="_blank"`) instead of plain text. Only valid with the string
   *  form of `subtitle`. */
  readonly subtitleHref?: string;
  /** Record field whose value selects the `statusTones` entry, for a badge text that
   *  carries more than the state (e.g. "Terminated on 31.03.2027"). Defaults to `status`. */
  readonly statusToneField?: string;
  /** Badge tone per `statusToneField` value (default: the `status` value); unlisted values fall back to the value heuristic. */
  readonly statusTones?: { readonly [statusValue: string]: SelectOptionTone };
};

// Same shape as `RowActionNavigate`'s screen/entity choice, minus the fields
// a metric click has no use for (id, confirm, style).
export type MetricNavigate = {
  readonly screen?: string;
  readonly entity?: string;
  readonly entityId?: string;
  readonly params?: RowFieldExtractor;
  /** Section id of the tab to activate at the destination. Alone (no
   *  `screen`/`entity`), it activates that tab on the current record
   *  instead of navigating away. */
  readonly tab?: string;
};

// `label` is an i18n key and required: there is no fallback to the raw column name.
export type MetricSpec = {
  readonly field: string;
  readonly label: string;
  readonly navigate?: MetricNavigate;
};

export type ProjectionDetailScreenDefinition = {
  readonly id: string;
  readonly type: "projectionDetail";
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
  readonly query: string;
  /** Query output field whose value titles the page header (breadcrumb) when no `header` is set. */
  readonly recordTitleField?: string;
  /** Query-payload key for the row-id. Default "id". */
  readonly idParam?: string;
  /** The server determines the shown row from the caller's session/context
   *  instead of a row id in the path — a self-service screen ("my profile",
   *  "my data") that has no row to link to (unlike `EntityEditScreenDefinition.
   *  singleton`, which still resolves via `<entity>:list` limit 1; here the
   *  query itself owns the row selection, e.g. `user:query:user:me`). The
   *  query is called WITHOUT the `idParam` key — there is no id to send, so
   *  the boot-validator rejects declaring `idParam` alongside this flag
   *  instead of letting one silently win. Stricter than an id-addressed
   *  screen, not looser: the server picks the row, so no client-supplied id
   *  can reach the query — a stray id on the path is ignored, never
   *  forwarded. */
  readonly singleton?: boolean;
  readonly layout: EditLayout;
  /** Optional per-field label i18n key (field name → key), analogous to
   *  entityEdit.fieldLabels. The pseudo entity `__projection-detail__` has
   *  no natural field namespace — a missing entry falls back to the
   *  convention `<feature>:entity:__projection-detail__:field:<name>`. */
  readonly fieldLabels?: Readonly<Record<string, string>>;
  /** Record header above the layout — title/subtitle/status name columns
   *  in the query row (not literals). Rendered only when set. */
  readonly header?: RecordHeaderSpec;
  /** Metric band above the layout — column names in the query row, each with its own i18n `label`.
   *  Rendered only when set. */
  readonly metrics?: readonly MetricSpec[];
  /** Parent list screen (short id) for a "back" navigation. */
  readonly listScreenId?: string;
  readonly slots?: ScreenSlots;
  readonly access?: AccessRule;
  /** Header action buttons. Reuses `RowAction` — the screen's single
   *  displayed record stands in for the "row", so `pick`/`map`, `visible`,
   *  `confirm`/`confirmLabel` and `style` keep their meaning unchanged.
   *  `rowClick` has no target here (there is no row to click) and is
   *  rejected by the boot-validator. */
  readonly actions?: readonly RowAction[];
  /** Id of the action that stays the visible header button when the actions
   *  collapse into a menu (and the one that keeps the phone icon slot when it
   *  has an icon and no confirm). An `actions` id or `"edit"` (the default edit
   *  action); default precedence is `edit`, then `style: "primary"`, then the
   *  first action. */
  readonly primaryAction?: string;
  /** How head fields render. Default "text" — plain text instead of a
   *  disabled Input, since every field on this screen type is forced
   *  readOnly anyway (there is no write path, see the shim doc above).
   *  Set "form" to opt back into the disabled-Input look. */
  readonly valueDisplay?: "form" | "text";
};
