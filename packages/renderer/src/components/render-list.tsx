import {
  type EntityDefinition,
  type EntityListScreenDefinition,
  UNRESOLVED_REFERENCE_LABEL_KEYS,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { extensionSectionName, useExtensionSectionComponent } from "../app/extension-sections.tsx";
import { useReferenceLinkResolver } from "../app/reference-link.ts";
import { rendererWarn } from "../dev-console.ts";
import type {
  CellLinkItem,
  ListColumnViewModel,
  ListRowViewModel,
  ListViewModel,
  RuntimeCellLink,
  RuntimeCellLinkItems,
  RuntimeRenderer,
  Translate,
} from "../headless/index.ts";
import { computeListViewModel, EMPTY_VALUE_PLACEHOLDER } from "../headless/index.ts";
import type { ListSort } from "../hooks/use-list-url-state.ts";
import { type ReferenceLookupMap, useReferenceLookup } from "../hooks/use-reference-lookup.ts";
import { useTranslation } from "../i18n.tsx";
import { usePageHeaderCompact, usePageHeaderSlotAvailable } from "../page-header-slot.ts";
import {
  type ActionMenuItemSpec,
  type DataTableDateRangeFacet,
  type DataTableFacet,
  type DataTableProps,
  type DataTableRowAction,
  type DataTableRowActionMode,
  type DataTableTableBlockProps,
  shouldRenderActionsIconOnly,
  usePrimitives,
} from "../primitives.tsx";
import { ListEmptyStateBody, type ListEmptyStateContent } from "./list-empty-state.tsx";
import { needsActionConfirm } from "./render-edit-action-button.tsx";
import { type ToolbarActionButton, ToolbarActionView } from "./render-list-toolbar-action.tsx";

export type { ToolbarActionButton };

// RenderList is a presentational view for entityList screens.
//
// Data and state are fully controlled by the caller (KumikoScreen):
//   - rows come from the server (through the useQuery + URL-state payload)
//   - sort/q are props; RenderList calls onSortChange/onQChange when
//     the user performs UI actions
//   - Search is server-side (via SearchAdapter / Meilisearch). Local state
//     in the search input is only a debounce buffer, not a filter.
//
// Apps that use RenderList without server state (for example, a static
// lookup) provide stable rows and omit sort/q — DataTable then falls back
// to no sort wiring and no search.

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

const SEARCH_DEBOUNCE_MS = 300;

// Icon-less actions are promoted too; on phones the call site falls back to a
// "plus" icon, on desktop the label carries the action.
function isHeaderPromotableToolbarAction(action: ToolbarActionButton): boolean {
  return action.style === "primary" && !needsActionConfirm(action);
}

export function RenderList(props: RenderListProps): ReactNode {
  const {
    screen,
    entity,
    rows,
    featureName,
    translate: translateProp,
    onRowClick,
    emptyState,
    onCreate,
    createLabel,
    searchable = false,
    searchPlaceholder,
    description,
    emptyContent,
    narrowed = false,
    defaultFilterActive: defaultFilterActiveProp = false,
    itemNounKey,
    searchValue,
    onSearchChange,
    sort,
    onSortChange,
    pager,
    onReachEnd,
    loadingMore,
    hasMore,
    rowActions,
    rowActionMode,
    bulk,
    rowTone,
    toolbarActions,
    filterFacets,
    filterValues,
    onFilterChange,
    onFilterReset,
    dateRangeFacets,
    onDateRangeChange,
    chromeless,
    scrollBody,
    screenPadding,
    expandedRowIds,
    onToggleRowExpanded,
    renderExpandedRow,
    ...tableBlockProps
  } = props;
  // As in RenderEdit, fall back to the i18next context for translation;
  // otherwise column headers would display raw i18n keys.
  const t = useTranslation();
  const translate: Translate = translateProp ?? t;
  const { DataTable, Button, Dialog, Input, Banner, PageHeader } = usePrimitives();
  const pageHeaderSlotAvailable = usePageHeaderSlotAvailable();
  const pageHeaderCompact = usePageHeaderCompact();
  const createInPageHeader =
    onCreate !== undefined && PageHeader !== undefined && pageHeaderSlotAvailable;
  // Promoted actions that moved into the phone header's overflow menu have no button of
  // their own, so their busy and error state lives here.
  const [menuActionBusyId, setMenuActionBusyId] = useState<string | null>(null);
  const [menuActionError, setMenuActionError] = useState<string | null>(null);

  // Local search buffer + debounce. External changes (browser back,
  // cross-component reset) are mirrored back; typing only fires
  // onSearchChange after 300ms without further keystrokes.
  const [localQ, setLocalQ] = useState(searchValue ?? "");
  // Sync during render, not in a useEffect: the passive effect also fires on
  // mount and can flush after a keystroke landing in the same commit,
  // resetting localQ and swallowing the input.
  const [syncedSearchValue, setSyncedSearchValue] = useState(searchValue);
  // The parent may echo our own debounced emits back late (router/URL round
  // trip), possibly after a newer emit already went out; adopting such a stale
  // echo would erase keys typed in between. All unechoed emits are kept, and a
  // matching echo drops itself and every older one. The render phase only reads
  // the list (a discarded or repeated render must find the echo again); the
  // matched entries are dropped in an effect.
  const pendingEmitsRef = useRef<string[]>([]);
  if (searchValue !== syncedSearchValue) {
    setSyncedSearchValue(searchValue);
    if (!pendingEmitsRef.current.includes(searchValue ?? "")) {
      setLocalQ(searchValue ?? "");
      pendingEmitsRef.current = [];
    }
  }
  useEffect(() => {
    const echoIndex = pendingEmitsRef.current.indexOf(syncedSearchValue ?? "");
    if (echoIndex >= 0) pendingEmitsRef.current.splice(0, echoIndex + 1);
  }, [syncedSearchValue]);
  useEffect(() => {
    if (onSearchChange === undefined) return;
    if (localQ === (searchValue ?? "")) return;
    // A late echo of an older emit changes searchValue but must not re-send
    // the value that is already in flight.
    if (pendingEmitsRef.current.at(-1) === localQ) return;
    const timer = setTimeout(() => {
      pendingEmitsRef.current.push(localQ);
      onSearchChange(localQ);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [localQ, searchValue, onSearchChange]);

  const vm = useMemo(
    () => computeListViewModel({ screen, entity, rows, translate, featureName }),
    [screen, entity, rows, translate, featureName],
  );

  // Reference-field eager loading through bridge components.
  // The Hooks rule requires useReferenceLookup for each reference column,
  // but the number of columns varies with the schema. Each column therefore
  // mounts a ReferenceLookupBridge that publishes its map to local state
  // through onMap. Each bridge makes a constant number of hook calls (one),
  // and React manages its lifecycle when the schema changes via key.
  const referenceColumns = useMemo(
    () =>
      vm.columns
        .filter((c: ListColumnViewModel) => c.type === "reference" && c.refEntity !== undefined)
        .map((c: ListColumnViewModel) => ({
          field: c.field,
          refEntity: c.refEntity ?? "",
          // refFeature comes from parseRefTarget in the ViewModel
          // (default = the current featureName).
          refFeature: c.refFeature ?? featureName,
          labelField: c.refLabelField ?? "id",
        })),
    [vm.columns, featureName],
  );
  const [referenceLookups, setReferenceLookups] = useState<
    Record<string, PublishedReferenceLookup>
  >({});
  const handleLookupMap = useCallback((field: string, lookup: PublishedReferenceLookup) => {
    setReferenceLookups((prev) => {
      // Skip the update when the lookup is identical. Otherwise the bridge
      // would re-render and send the same map back until React entered
      // an infinite loop.
      const current = prev[field];
      if (current?.map === lookup.map && current.complete === lookup.complete) return prev;
      return { ...prev, [field]: lookup };
    });
  }, []);
  const resolveReferenceLink = useReferenceLinkResolver();
  const enrichedColumns = useMemo((): readonly ListColumnViewModel[] => {
    if (referenceColumns.length === 0) return vm.columns;
    return vm.columns.map((col: ListColumnViewModel) => {
      if (col.type !== "reference") return col;
      // An author-declared renderer always takes precedence;
      // the default is used only when none is set.
      if (col.renderer !== undefined) return col;
      const published = referenceLookups[col.field];
      const map = published?.map;
      const unknownKey =
        UNRESOLVED_REFERENCE_LABEL_KEYS[`${col.refFeature ?? featureName}:${col.refEntity ?? ""}`];
      // No raw id for entities that opt in: a placeholder while the lookup
      // loads, the "unknown" label once the complete lookup found nothing. A
      // capped lookup page cannot prove absence, so it keeps the raw id.
      const unresolvedLabel = (id: string): string =>
        unknownKey === undefined
          ? id
          : published === undefined
            ? EMPTY_VALUE_PLACEHOLDER
            : published.complete
              ? translate(unknownKey)
              : id;
      const labelField = col.refLabelField ?? "id";
      const refEntity = col.refEntity ?? "";
      // Only a row the user can see is linkable: resolved by the server
      // eagerload or by the lookup query. A multi-reference links per entry via linkItemsFor.
      const linkFor: RuntimeCellLink = (value, row) => {
        if (value === null || value === undefined || value === "" || Array.isArray(value)) {
          return undefined;
        }
        const id = String(value);
        const eagerloaded = eagerloadedRef(row, col.field);
        // The server leaves a missing or unreadable target out; null is treated the same.
        const resolved =
          (typeof eagerloaded === "object" &&
            eagerloaded !== null &&
            !Array.isArray(eagerloaded)) ||
          map?.has(id);
        return resolved === true ? resolveReferenceLink(refEntity, id) : undefined;
      };
      const linkItemsFor: RuntimeCellLinkItems = (value, row) => {
        if (!Array.isArray(value) || value.length === 0) return undefined;
        const eagerloaded = eagerloadedRef(row, col.field);
        const eagerById = new Map<string, Record<string, unknown>>(
          Array.isArray(eagerloaded) ? eagerloaded.map((r) => [String(r["id"]), r]) : [],
        );
        return value.map((v): CellLinkItem => {
          const id = String(v);
          const target = eagerById.get(id);
          const label = String(target?.[labelField] ?? map?.get(id) ?? unresolvedLabel(id));
          // Only a row the user can see is linkable: server eagerload or lookup query.
          const link =
            target !== undefined || map?.has(id) === true
              ? resolveReferenceLink(refEntity, id)
              : undefined;
          return { id, label, ...(link !== undefined && { link }) };
        });
      };
      const renderer: RuntimeRenderer = (
        value: unknown,
        row?: Readonly<Record<string, unknown>>,
      ): string => {
        // Server eager loading: when the server includes _refs, read the display
        // value directly from the resolved row. This avoids a round trip
        // through the bridge map and the limit:200 constraint. The
        // EagerloadedRow type from @cosmicdrift/kumiko-framework/db defines
        // the shape of _refs.
        const resolved = eagerloadedRef(row, col.field);
        if (Array.isArray(resolved) && resolved.length > 0) {
          return resolved.map((r) => String(r[labelField] ?? r["id"] ?? "")).join(", ");
        }
        if (isPlainRecord(resolved)) {
          return String(resolved[labelField] ?? resolved["id"] ?? "");
        }
        // Renderer-side fallback when server eager loading is not active.
        if (Array.isArray(value)) {
          if (value.length === 0) return EMPTY_VALUE_PLACEHOLDER;
          return value.map((v) => map?.get(String(v)) ?? unresolvedLabel(String(v))).join(", ");
        }
        if (value === null || value === undefined || value === "") return EMPTY_VALUE_PLACEHOLDER;
        const idStr = String(value);
        return map?.get(idStr) ?? unresolvedLabel(idStr);
      };
      return { ...col, renderer, linkFor, linkItemsFor };
    });
  }, [
    vm.columns,
    referenceColumns,
    referenceLookups,
    resolveReferenceLink,
    featureName,
    translate,
  ]);
  const enrichedVm = useMemo(
    (): Omit<ListViewModel, "columns"> & { columns: readonly ListColumnViewModel[] } => ({
      ...vm,
      columns: enrichedColumns,
    }),
    [vm, enrichedColumns],
  );

  // i18n defaults for toolbar and empty-state strings. The caller can
  // override each one through a prop; otherwise the framework bundles provide
  // them (kumiko.actions.create, kumiko.list.search-placeholder, …).
  const effectiveCreateLabel = translate(
    createLabel ?? screen.createLabel ?? "kumiko.actions.create",
  );
  const effectiveSearchPlaceholder = translate(
    searchPlaceholder ?? screen.searchPlaceholder ?? "kumiko.list.search-placeholder",
  );

  const nounKey = itemNounKey ?? `${featureName}:entity:${screen.entity}:noun`;
  const itemNoun =
    (itemNounKey !== undefined || !screen.entity.startsWith("__")) &&
    translate(nounKey, { count: 2 }) !== nounKey
      ? (count: number): string => translate(nounKey, { count })
      : undefined;

  const toolbarStart = searchable ? (
    <Input
      kind="text"
      id="render-list-search"
      name="search"
      value={localQ}
      onChange={setLocalQ}
      placeholder={effectiveSearchPlaceholder}
    />
  ) : undefined;

  // Toolbar-end slot: an optional header slot (for example, a cap counter,
  // at the left of the right-hand cluster), toolbar actions from the schema,
  // and an optional "+ New" button at the right edge. The header slot lives
  // inside the toolbar row, with the same card frame, rather than as loose
  // text above the screen title. Items retain array order, and "+ New" comes
  // last because it is the most common and prominent CTA.
  const hasToolbarActions = toolbarActions !== undefined && toolbarActions.length > 0;
  const hasHeaderSlot = screen.slots?.header !== undefined;
  const toolbarIconOnly = hasToolbarActions && shouldRenderActionsIconOnly(toolbarActions);
  const createButton =
    onCreate !== undefined && createInPageHeader && pageHeaderCompact ? (
      <Button
        variant="primary"
        icon="plus"
        size="icon"
        ariaLabel={effectiveCreateLabel}
        title={effectiveCreateLabel}
        onClick={onCreate}
        testId="render-list-create"
      />
    ) : onCreate !== undefined ? (
      <Button
        variant="primary"
        icon="plus"
        onClick={onCreate}
        testId="render-list-create"
        className="px-3.5"
      >
        {effectiveCreateLabel}
      </Button>
    ) : undefined;
  // Every primary toolbar action takes the page-header slot, left of the create
  // button (which stays the rightmost primary action): labelled on desktop, so
  // projection lists look like entity lists. On phones an icon button, or, next to
  // the create button, an entry in the header's overflow menu: the header has no
  // room for a labelled action beside it.
  const promotedToolbarActions =
    PageHeader !== undefined && pageHeaderSlotAvailable
      ? (toolbarActions?.filter(isHeaderPromotableToolbarAction) ?? [])
      : [];
  const promotedInOverflowMenu =
    pageHeaderCompact && createInPageHeader && promotedToolbarActions.length > 0;
  const promotedMenuItems: readonly ActionMenuItemSpec[] = promotedInOverflowMenu
    ? promotedToolbarActions.map((a) => ({
        id: a.id,
        label: a.label,
        ...(a.icon !== undefined && { icon: a.icon }),
        ...(menuActionBusyId !== null && { disabled: true }),
        testId: `render-list-toolbar-action-${a.id}`,
        onSelect: () => {
          setMenuActionBusyId(a.id);
          setMenuActionError(null);
          void (async () => {
            try {
              await a.onTrigger();
            } catch (e) {
              setMenuActionError(e instanceof Error ? e.message : String(e));
            } finally {
              setMenuActionBusyId(null);
            }
          })();
        },
      }))
    : [];
  const headerActions =
    promotedToolbarActions.length > 0 && !promotedInOverflowMenu ? (
      <>
        {promotedToolbarActions.map((a) => (
          <ToolbarActionView
            key={a.id}
            action={pageHeaderCompact ? { ...a, icon: a.icon ?? "plus" } : a}
            iconOnly={pageHeaderCompact}
            Button={Button}
            Dialog={Dialog}
            Banner={Banner}
          />
        ))}
        {createInPageHeader && createButton}
      </>
    ) : createInPageHeader ? (
      createButton
    ) : undefined;
  const toolbarActionsInToolbar =
    toolbarActions?.filter((a) => !promotedToolbarActions.includes(a)) ?? [];
  const hasToolbarActionsInToolbar = toolbarActionsInToolbar.length > 0;
  const toolbarEnd =
    hasHeaderSlot ||
    hasToolbarActionsInToolbar ||
    (onCreate !== undefined && !createInPageHeader) ? (
      <>
        {hasHeaderSlot && <ListHeaderSlotMount screen={screen} />}
        {hasToolbarActionsInToolbar &&
          toolbarActionsInToolbar.map((a) => (
            <ToolbarActionView
              key={a.id}
              action={a}
              iconOnly={toolbarIconOnly}
              Button={Button}
              Dialog={Dialog}
              Banner={Banner}
            />
          ))}
        {!createInPageHeader && createButton}
      </>
    ) : undefined;

  // Empty state: by default, show a heading, description, and optional CTA
  // button. The caller can replace it completely through emptyState.
  // Without onCreate or an override, DataTable uses its default
  // (`kumiko.list.no-entries`).
  const defaultFilterActive = defaultFilterActiveProp && onFilterReset !== undefined;
  const composedEmptyState =
    emptyState ??
    (onCreate !== undefined || emptyContent !== undefined || narrowed || defaultFilterActive ? (
      <ListEmptyStateBody
        content={emptyContent}
        narrowed={narrowed}
        defaultFilterActive={defaultFilterActive}
        {...(onFilterReset !== undefined && { onShowAll: onFilterReset })}
        translate={translate}
        createButton={
          onCreate !== undefined && !narrowed && !defaultFilterActive && !createInPageHeader ? (
            <Button
              variant="primary"
              icon="plus"
              onClick={onCreate}
              testId="render-list-empty-create"
            >
              {effectiveCreateLabel}
            </Button>
          ) : undefined
        }
      />
    ) : undefined);

  // Title resolution uses the conventional i18n key `screen:<id>.title`.
  // If the bundle knows the key, use its translated title; otherwise use
  // screenId so the app developer can see that the translation is missing.
  const titleKey = `screen:${screen.id}.title`;
  const resolvedTitle = translate(titleKey);
  const toolbarTitle = resolvedTitle === titleKey ? screen.id : resolvedTitle;

  return (
    <>
      {headerActions !== undefined && PageHeader !== undefined && (
        <PageHeader
          actions={headerActions}
          {...(promotedInOverflowMenu && { overflowItems: promotedMenuItems })}
        />
      )}
      {menuActionError !== null && (
        <Banner variant="error" testId="render-list-toolbar-action-error">
          {menuActionError}
        </Banner>
      )}
      {referenceColumns.map(
        (rc: { field: string; refEntity: string; refFeature: string; labelField: string }) => (
          <ReferenceLookupBridge
            key={rc.field}
            field={rc.field}
            refEntity={rc.refEntity}
            labelField={rc.labelField}
            featureName={rc.refFeature}
            onMap={handleLookupMap}
          />
        ),
      )}
      <DataTable
        columns={enrichedVm.columns}
        rows={enrichedVm.rows}
        toolbarTitle={toolbarTitle}
        {...(onRowClick !== undefined && { onRowClick })}
        {...(composedEmptyState !== undefined && { emptyState: composedEmptyState })}
        {...(toolbarStart !== undefined && { toolbarStart })}
        {...(description !== undefined && { toolbarDescription: description })}
        {...(toolbarEnd !== undefined && { toolbarEnd })}
        {...(sort !== undefined && { sort })}
        {...(onSortChange !== undefined && { onSortChange })}
        {...(pager !== undefined && { pager })}
        {...(onReachEnd !== undefined && { onReachEnd })}
        {...(loadingMore !== undefined && { loadingMore })}
        {...(hasMore !== undefined && { hasMore })}
        {...(itemNoun !== undefined && { itemNoun })}
        {...(rowActions !== undefined && { rowActions })}
        {...(rowActionMode !== undefined && { rowActionMode })}
        {...(bulk !== undefined && { bulk })}
        {...(rowTone !== undefined && { rowTone })}
        {...(filterFacets !== undefined && { filterFacets })}
        {...(filterValues !== undefined && { filterValues })}
        {...(onFilterChange !== undefined && { onFilterChange })}
        {...(onFilterReset !== undefined && { onFilterReset })}
        {...(dateRangeFacets !== undefined && { dateRangeFacets })}
        {...(onDateRangeChange !== undefined && { onDateRangeChange })}
        {...(chromeless !== undefined && { chromeless })}
        {...(scrollBody !== undefined && { scrollBody })}
        {...(screenPadding !== undefined && { screenPadding })}
        {...(expandedRowIds !== undefined && { expandedRowIds })}
        {...(onToggleRowExpanded !== undefined && { onToggleRowExpanded })}
        {...(renderExpandedRow !== undefined && { renderExpandedRow })}
        {...tableBlockProps}
        testId="render-list-table"
      />
    </>
  );
}

// Header slot in the list toolbar (toolbarEnd): `screen.slots.header` is
// a PlatformComponent (`{ react: { __component: "X" } }`) resolved through
// the same ExtensionSectionsProvider registry as entityEdit sections.
// entityId is null in the list context because there is no row; the component
// loads its own data (for example, a cap counter from a usage query). A
// separate component is required by the Rules of Hooks because
// useExtensionSectionComponent must not run conditionally in RenderList.
function ListHeaderSlotMount({
  screen,
}: {
  readonly screen: EntityListScreenDefinition;
}): ReactNode {
  const header = screen.slots?.header;
  const name = header !== undefined ? extensionSectionName(header) : undefined;
  const Component = useExtensionSectionComponent(name);
  // A declared-but-unregistered header slot renders nothing; warn so the author
  // finds the typo / missing clientFeatures.extensionSectionComponents entry,
  // mirroring the diagnostic banner in render-edit's ExtensionSectionMount
  // (the toolbar has no room for a banner, so a dev-warn it is).
  useEffect(() => {
    if (name !== undefined && Component === undefined) {
      rendererWarn(
        `[kumiko] List header slot component "${name}" on screen "${screen.id}" is not registered in clientFeatures.extensionSectionComponents — the header slot renders nothing.`,
      );
    }
  }, [name, Component, screen.id]);
  if (Component === undefined) return null;
  // screenId lets a header control drive this list's URL-filter state
  // (useListUrlState) — e.g. a tag filter narrowing the list to an id-set.
  return <Component entityName={screen.entity} entityId={null} screenId={screen.id} />;
}

type PublishedReferenceLookup = {
  readonly map: ReferenceLookupMap;
  readonly complete: boolean;
};

// Bridge component for each reference column. It is mounted once per
// column, calls useReferenceLookup unconditionally, and publishes the map
// to the parent through onMap. React manages mounting and unmounting when
// the schema changes through the key prop in the parent's map loop.
function ReferenceLookupBridge({
  field,
  refEntity,
  labelField,
  featureName,
  onMap,
}: {
  readonly field: string;
  readonly refEntity: string;
  readonly labelField: string;
  readonly featureName: string;
  readonly onMap: (field: string, lookup: PublishedReferenceLookup) => void;
}): null {
  const lookup = useReferenceLookup(featureName, refEntity, labelField);
  // Use an effect rather than calling directly so setState runs outside the
  // render path; otherwise React warns about updating one component while
  // rendering another.
  // Do not publish while loading or after a failed lookup: a missing map means
  // "not resolved", whereas an empty published map means "nothing found".
  // Only the latter may display "Unknown".
  const resolved = !lookup.loading && !lookup.failed;
  useEffect(() => {
    if (resolved) onMap(field, { map: lookup.map, complete: lookup.complete });
  }, [field, lookup.map, lookup.complete, resolved, onMap]);
  return null;
}

type EagerloadedRef = Record<string, unknown> | readonly Record<string, unknown>[] | undefined;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The server leaves a missing or unreadable target out of `_refs`, and a null
// entry means the same: both read as unresolved.
function eagerloadedRef(row: unknown, field: string): EagerloadedRef {
  if (!isPlainRecord(row) || !isPlainRecord(row["_refs"])) return undefined;
  const ref = row["_refs"][field];
  if (Array.isArray(ref)) return ref.filter(isPlainRecord);
  return isPlainRecord(ref) ? ref : undefined;
}
