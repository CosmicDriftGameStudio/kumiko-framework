import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import type { ListRowViewModel, Translate } from "../headless/index.ts";
import type { ListSort } from "../hooks/use-list-url-state.ts";
import type {
  DataTableDateRangeFacet,
  DataTableFacet,
  DataTableProps,
  DataTableRowAction,
  DataTableRowActionMode,
  DataTableTableBlockProps,
} from "../primitives.tsx";
import type { ListEmptyStateContent } from "./list-empty-state.tsx";
import type { ToolbarActionButton } from "./render-list-toolbar-action.tsx";

export type RenderListProps = {
  readonly screen: EntityListScreenDefinition;
  readonly entity: Pick<EntityDefinition, "fields" | "derivedFields">;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly featureName: string;
  readonly translate?: Translate;
  readonly onRowClick?: (row: ListRowViewModel) => void;
  /** Overrides the default empty box. When set, the automatic CTA via
   *  `onCreate` is ignored; the caller's content takes precedence. */
  readonly emptyState?: ReactNode;
  /** Adds a "+ New" button to the toolbar and uses it as the CTA in the
   *  default empty box. The caller provides the action (for example,
   *  navigation to the edit screen). */
  readonly onCreate?: () => void;
  /** Label for the + New button. Defaults to the i18n bundle key
   *  (`kumiko.actions.create`). The caller can override it. */
  readonly createLabel?: string;
  /** Enables a search input in the toolbar. Filtering is server-side via
   *  the caller's onSearchChange; RenderList does not filter locally. */
  readonly searchable?: boolean;
  /** Placeholder for the search input. Defaults to the i18n bundle key
   *  (`kumiko.list.search-placeholder`). */
  readonly searchPlaceholder?: string;
  /** Hint at the left of the toolbar (already translated). */
  readonly description?: string;
  /** Author-declared replacement for the default empty box (already translated). */
  readonly emptyContent?: ListEmptyStateContent;
  /** Search or filters changed the result; the empty box then says "no matches". */
  readonly narrowed?: boolean;
  /** Nothing was narrowed by the user, but a default filter is still on; the empty box then offers "show all" instead of "create the first one". */
  readonly defaultFilterActive?: boolean;
  /** Plural-forms key for the footer count noun; default is the entity's `:noun` convention key. */
  readonly itemNounKey?: string;
  /** Current search term (from URL state / the parent). RenderList buffers
   *  typing locally with a 300ms debounce before calling onSearchChange;
   *  otherwise every keystroke would trigger a server round trip. */
  readonly searchValue?: string;
  /** Called when the debounced search term changes. The caller uses it to
   *  set URL state (?<id>.q=…) and trigger a refetch. */
  readonly onSearchChange?: (next: string) => void;
  /** Current sorting, or null for the server's default order. */
  readonly sort?: ListSort | null;
  /** Called with the next sort state after a header click. */
  readonly onSortChange?: (next: ListSort | null) => void;
  /** Pager props for pagination="pages". If undefined, no pager UI is
   *  rendered; the default or infinite mode is used. KumikoScreen supplies
   *  this according to screen.pagination. */
  readonly pager?: {
    readonly page: number;
    readonly limit: number;
    readonly total: number;
    readonly onPageChange: (next: number) => void;
  };
  /** Infinite-scroll wiring for pagination="infinite". KumikoScreen keeps
   *  the accumulated rows and cursor; RenderList passes the callbacks
   *  through to DataTable. */
  readonly onReachEnd?: () => void;
  readonly loadingMore?: boolean;
  readonly hasMore?: boolean;
  /** Per-row actions in resolved form. KumikoScreen builds them from
   *  EntityListScreenDefinition.rowActions: handler-QN becomes a dispatcher
   *  call, and i18n keys become translated strings. */
  readonly rowActions?: readonly DataTableRowAction[];
  /** How the row-action column renders (see `DataTableProps.rowActionMode`). KumikoScreen
   *  derives it from the actions; without it the DataTable uses its adaptive default. */
  readonly rowActionMode?: DataTableRowActionMode;
  /** Forwarded to `DataTableProps.bulk` / `rowTone`. */
  readonly bulk?: DataTableProps["bulk"];
  readonly rowTone?: DataTableProps["rowTone"];
  /** Toolbar actions in the list header in resolved form. KumikoScreen
   *  builds them from EntityListScreenDefinition.toolbarActions:
   *  navigate targets use useNav and handler-QN uses a dispatcher call.
   *  RenderList renders the buttons on the right side of the toolbar,
   *  before "+ New". */
  readonly toolbarActions?: readonly ToolbarActionButton[];
  /** Faceted filter dropdowns. KumikoScreen builds them from filterable
   *  select/boolean fields; RenderList passes them through to DataTable. */
  readonly filterFacets?: readonly DataTableFacet[];
  /** Currently selected facet values by field (from URL state). */
  readonly filterValues?: Readonly<Record<string, readonly string[]>>;
  /** Toggles a facet value (sets URL state and refetches). */
  readonly onFilterChange?: (field: string, values: readonly string[]) => void;
  /** Reset aller aktiven Facets. */
  readonly onFilterReset?: () => void;
  /** Time-range filters — forwarded to the DataTable. */
  readonly dateRangeFacets?: readonly DataTableDateRangeFacet[];
  /** One bound changed (set URL state + refetch). */
  readonly onDateRangeChange?: (field: string, bound: "from" | "to", value: string) => void;
  /** Forwarded to `DataTableProps.chromeless` — drops the table's own card frame for a
   *  host that already provides one (relatedList in a tabs-mode section). Default false. */
  readonly chromeless?: boolean;
  /** Forwarded to `DataTableProps.scrollBody` — bounds the table height and scrolls rows
   *  internally instead of growing the page (relatedList in a tabs-mode section). Default false. */
  readonly scrollBody?: boolean;
  /** Forwarded to `DataTableProps.screenPadding` — `true`: the table carries
   *  the shared screen padding because it is the screen body (entityList/
   *  projectionList). Explicit `false`: no padding at all — the host already
   *  pads its own children (relatedList in a tabs-mode Card). Omitted: legacy
   *  `p-6` fallback for a standalone table with no padded host. */
  readonly screenPadding?: boolean;
  /** Forwarded to `DataTableProps.expandedRowIds` / `onToggleRowExpanded` /
   *  `renderExpandedRow` (entityList `expandableRow`). */
  readonly expandedRowIds?: ReadonlySet<string>;
  readonly onToggleRowExpanded?: (rowId: string) => void;
  readonly renderExpandedRow?: (row: ListRowViewModel) => ReactNode;
} & DataTableTableBlockProps;
