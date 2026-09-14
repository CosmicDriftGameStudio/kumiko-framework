import type {
  EntityEditScreenDefinition,
  IconKey,
  RelatedListToolbarAction,
  RowAction,
  RowActionDrawer,
  RowActionNavigate,
  RowActionWriteHandler,
  RowFieldExtractor,
  ToolbarAction,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { evalFieldCondition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher, ListRowViewModel, Translate } from "@cosmicdrift/kumiko-headless";
import type { ToolbarActionButton } from "../components/render-list";
import type { DataTableRowAction } from "../primitives";
import type { NavApi } from "./nav";
import { lastSegment } from "./qn";
import { dispatcherErrorText, WriteFailedError } from "./write-failed-error";

// entityId is explicit: the edit screen may live in another feature than
// the row source, where the same-feature fallback would miss it.
export function buildDefaultEditRowAction(
  editScreen: EntityEditScreenDefinition | undefined,
  idColumn = "id",
): RowActionNavigate | undefined {
  if (editScreen === undefined) return undefined;
  return {
    kind: "navigate",
    id: "edit",
    label: "kumiko.actions.edit",
    screen: lastSegment(editScreen.id),
    entityId: idColumn,
  };
}

export function evalRowExtractor(
  extractor: RowFieldExtractor,
  row: Record<string, unknown>,
): Record<string, unknown> {
  if ("pick" in extractor) {
    return Object.fromEntries(extractor.pick.map((f) => [f, row[f]]));
  }
  return Object.fromEntries(Object.entries(extractor.map).map(([to, from]) => [to, row[from]]));
}

export function isWriteHandlerRowAction(action: RowAction): action is RowActionWriteHandler {
  return action.kind === "writeHandler" || action.kind === undefined;
}

// Part B (fw-ui-defaults): id-derived default icon for actions that never
// declared one — a screen author still gets a recognizable glyph instead of
// a bare label. Checked against the actually registered IconKey vocabulary
// (nav-icon.ts) — no entry for verbs without a matching icon (e.g. "start",
// "pause").
const ACTION_ICON_BY_ID: Readonly<Partial<Record<string, IconKey>>> = {
  delete: "trash",
  edit: "pencil",
  create: "plus",
  new: "plus",
  add: "plus",
  view: "eye",
  open: "eye",
  cancel: "x",
  reject: "x",
  complete: "check",
  resolve: "check",
  approve: "check",
  archive: "archive",
  publish: "upload",
  duplicate: "copy",
  copy: "copy",
  download: "download",
  refresh: "refresh",
  retry: "refresh",
  settings: "settings",
  share: "share",
  send: "send",
};

// Ids are kebab-case (RowAction.id doc): aggregate-object-verb
// ("order-ship") or verb-prefix ("add-item").
function kebabLastSegment(id: string): string {
  const idx = id.lastIndexOf("-");
  return idx === -1 ? id : id.slice(idx + 1);
}

function kebabFirstSegment(id: string): string {
  const idx = id.indexOf("-");
  return idx === -1 ? id : id.slice(0, idx);
}

// Resolution order: author-declared `icon` wins, then the id-derived
// default (full id, then its last kebab segment, then its first kebab
// segment). `declared` is `undefined` for ToolbarAction, which has no
// author-facing icon field.
export function resolveActionIcon(id: string, declared?: IconKey): IconKey | undefined {
  if (declared !== undefined) return declared;
  return (
    ACTION_ICON_BY_ID[id] ??
    ACTION_ICON_BY_ID[kebabLastSegment(id)] ??
    ACTION_ICON_BY_ID[kebabFirstSegment(id)]
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto: object | null = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function stringifyNavParams(params: Record<string, unknown>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(params)) {
    // Structured field values such as money `{amount, currency}` must survive
    // the URL round-trip as JSON; Date & other class instances stay String().
    out[k] =
      v === null || v === undefined
        ? null
        : Array.isArray(v) || isPlainObject(v)
          ? JSON.stringify(v)
          : String(v);
  }
  return out;
}

export async function refetchAfterWrite(refetch: () => Promise<unknown>): Promise<void> {
  await refetch().catch((err: unknown) => {
    // biome-ignore lint/suspicious/noConsole: refetch must not poison the write-action error path
    console.error("kumiko-screen: refetch after write action failed", err);
  });
}

// Navigate execution for query-driven rows (projectionList, and relatedList
// — both have no guaranteed "id" field, unlike entityList's rows which back
// a real entity). No same-entity row["id"] fallback (see EntityListBody's
// own runNavigate for that variant, which stays separate — entityList's
// fallback needs `screen.entity`, which neither projectionList nor
// relatedList has).
export function runProjectionRowNavigate(
  nav: NavApi,
  action: RowActionNavigate,
  row: ListRowViewModel,
): void {
  if (action.entity !== undefined) {
    const id = action.entityId !== undefined ? String(row.values[action.entityId] ?? "") : "";
    // skip: no entityId column on this row — nothing to navigate to.
    if (id === "") return;
    nav.navigate({ entity: action.entity, id });
  } else if (action.screen !== undefined) {
    const entityId =
      action.entityId !== undefined ? String(row.values[action.entityId] ?? "") : undefined;
    nav.navigate({
      screenId: action.screen,
      ...(entityId !== undefined && entityId !== "" && { entityId }),
    });
  } else {
    // skip: neither entity nor screen set — the boot-validator rejects this
    // shape (resolveRowActionNavigateTarget), so this only guards types.
    return;
  }
  const params =
    action.params !== undefined ? evalRowExtractor(action.params, row.values) : undefined;
  if (params !== undefined) {
    nav.setSearchParams(stringifyNavParams(params));
  }
}

function buildNavigateRowAction(
  action: RowActionNavigate,
  translate: Translate,
  nav: NavApi,
): DataTableRowAction {
  const { visible } = action;
  const actionIcon = resolveActionIcon(action.id, action.icon);
  return {
    id: action.id,
    label: translate(action.label),
    ...(action.style !== undefined && { style: action.style }),
    confirmRequired: false,
    ...(actionIcon !== undefined && { icon: actionIcon }),
    onTrigger: (row: ListRowViewModel) => runProjectionRowNavigate(nav, action, row),
    ...(visible !== undefined && {
      isVisible: (row: ListRowViewModel) => evalFieldCondition(visible, row.values),
    }),
  };
}

type OpenDrawer = (
  action: RowActionDrawer,
  initialValues: Readonly<Record<string, unknown>> | undefined,
) => void;

// Dedupes the "openDrawer not wired" warning per action id, since the
// builders re-run inside a useMemo on every dep change.
const warnedDrawerActionIds = new Set<string>();

function warnDrawerActionDropped(
  actionKind: "rowAction" | "toolbarAction",
  actionId: string,
): void {
  const key = `${actionKind}:${actionId}`;
  // skip: already warned for this id — suppresses the repeat, not the warning itself.
  if (warnedDrawerActionIds.has(key)) return;
  warnedDrawerActionIds.add(key);
  // biome-ignore lint/suspicious/noConsole: dev-warning for a setup error
  console.warn(
    `[kumiko] ${actionKind} "${actionId}" is kind:"drawer", but the host did not wire openDrawer (RelatedListSection: pass onOpenDrawer) — it will not render.`,
  );
}

function buildDrawerRowAction(
  action: RowActionDrawer,
  translate: Translate,
  openDrawer: OpenDrawer,
): DataTableRowAction {
  const { visible, params } = action;
  const actionIcon = resolveActionIcon(action.id, action.icon);
  return {
    id: action.id,
    label: translate(action.label),
    ...(action.style !== undefined && { style: action.style }),
    confirmRequired: false,
    ...(actionIcon !== undefined && { icon: actionIcon }),
    onTrigger: (row: ListRowViewModel) => {
      openDrawer(action, params !== undefined ? evalRowExtractor(params, row.values) : undefined);
    },
    ...(visible !== undefined && {
      isVisible: (row: ListRowViewModel) => evalFieldCondition(visible, row.values),
    }),
  };
}

// Prepends defaultEditRowAction unless a declared action already claims id
// "edit" — declared wins.
function mergeDefaultEditAction(
  rowActions: readonly RowAction[] | undefined,
  defaultEditRowAction: RowActionNavigate | undefined,
): readonly RowAction[] {
  const declaredHasEdit = rowActions?.some((a) => a.id === "edit") === true;
  return defaultEditRowAction !== undefined && !declaredHasEdit
    ? [defaultEditRowAction, ...(rowActions ?? [])]
    : (rowActions ?? []);
}

function buildWriteHandlerRowAction(
  action: RowActionWriteHandler,
  translate: Translate,
  refetch: () => Promise<unknown>,
  dispatcher: Dispatcher,
): DataTableRowAction {
  const writeVisible = action.visible;
  return {
    id: action.id,
    label: translate(action.label),
    ...(action.style !== undefined && { style: action.style }),
    icon: resolveActionIcon(action.id, action.icon),
    ...(action.confirm !== undefined && { confirm: translate(action.confirm) }),
    ...(action.confirmLabel !== undefined && {
      confirmLabel: translate(action.confirmLabel),
    }),
    onTrigger: async (row: ListRowViewModel) => {
      const payload =
        action.payload !== undefined
          ? evalRowExtractor(action.payload, row.values)
          : { id: row.values["id"] };
      const result = await dispatcher.write(action.handler, payload);
      if (!result.isSuccess) {
        throw new WriteFailedError(result.error, dispatcherErrorText(result.error, translate));
      }
      await refetchAfterWrite(refetch);
    },
    ...(writeVisible !== undefined && {
      isVisible: (row: ListRowViewModel) => evalFieldCondition(writeVisible, row.values),
    }),
  };
}

// Builds the DataTable-ready row-action set for a query-driven row source
// (projectionList, relatedList) — navigate dispatches through
// runProjectionRowNavigate, writeHandler dispatches through the shared
// Dispatcher and refetches `refetch` on success. Single implementation so
// projectionList's rowActions and a projectionDetail relatedList section's
// rowActions can't drift apart (fw editable-detail-screens).
export function buildProjectionRowActions(options: {
  readonly rowActions: readonly RowAction[] | undefined;
  readonly translate: Translate;
  readonly dispatcher: Dispatcher | undefined;
  readonly nav: NavApi;
  readonly refetch: () => Promise<unknown>;
  /** Opens the drawer-kind action's target actionForm, prefilled from the
   *  clicked row. Omitted callers (e.g. RelatedListSection embedded directly
   *  without onOpenDrawer) drop drawer actions and get a dev warning —
   *  mirrors the `dispatcher === undefined` skip below for writeHandler. */
  readonly openDrawer?: OpenDrawer;
  /** Prepended unless a declared action already has id "edit" — declared wins. */
  readonly defaultEditRowAction?: RowActionNavigate;
}): readonly DataTableRowAction[] | undefined {
  const { rowActions, translate, dispatcher, nav, refetch, openDrawer, defaultEditRowAction } =
    options;
  const effectiveActions = mergeDefaultEditAction(rowActions, defaultEditRowAction);
  if (effectiveActions.length === 0) return undefined;
  const out: DataTableRowAction[] = [];
  for (const action of effectiveActions) {
    if (action.kind === "navigate") {
      out.push(buildNavigateRowAction(action, translate, nav));
      continue;
    }
    if (action.kind === "drawer") {
      if (openDrawer === undefined) {
        warnDrawerActionDropped("rowAction", action.id);
        continue;
      }
      out.push(buildDrawerRowAction(action, translate, openDrawer));
      continue;
    }
    // writeHandler (default-kind) — a swallowed failure result must become a
    // thrown error (fw prod-bug 2026-06-07), same as every other write path.
    if (dispatcher === undefined) continue;
    out.push(buildWriteHandlerRowAction(action, translate, refetch, dispatcher));
  }
  return out.length > 0 ? out : undefined;
}

type OpenToolbarDrawer = (action: ToolbarAction & { readonly kind: "drawer" }) => void;

function buildNavigateToolbarAction(
  action: RelatedListToolbarAction & { readonly kind: "navigate" },
  translate: Translate,
  nav: NavApi,
  prefill: Readonly<Record<string, unknown>> | undefined,
  record: Readonly<Record<string, unknown>> | undefined,
): ToolbarActionButton {
  const actionIcon = resolveActionIcon(action.id);
  const target = action.screen;
  return {
    id: action.id,
    label: translate(action.label),
    ...(action.style !== undefined && { style: action.style }),
    confirmRequired: false,
    ...(actionIcon !== undefined && { icon: actionIcon }),
    onTrigger: () => {
      nav.navigate({ screenId: target });
      // A declared `params` extractor (evaluated against the relatedList's
      // parent record) replaces the caller's implicit prefill (e.g. a
      // relatedList's `{ [parentParam]: parentId }`) rather than merging
      // with it — same "params present → drop the default" rule as
      // rowActions.
      const resolvedParams =
        action.params !== undefined && record !== undefined
          ? evalRowExtractor(action.params, record)
          : prefill;
      if (resolvedParams !== undefined) {
        nav.setSearchParams(stringifyNavParams(resolvedParams));
      }
    },
  };
}

function buildDrawerToolbarAction(
  action: ToolbarAction & { readonly kind: "drawer" },
  translate: Translate,
  openDrawer: OpenToolbarDrawer,
): ToolbarActionButton {
  const actionIcon = resolveActionIcon(action.id);
  return {
    id: action.id,
    label: translate(action.label),
    ...(action.style !== undefined && { style: action.style }),
    confirmRequired: false,
    ...(actionIcon !== undefined && { icon: actionIcon }),
    onTrigger: () => openDrawer(action),
  };
}

function buildWriteHandlerToolbarAction(
  action: ToolbarAction & { readonly kind: "writeHandler" },
  translate: Translate,
  refetch: () => Promise<unknown>,
  dispatcher: Dispatcher,
): ToolbarActionButton {
  const actionIcon = resolveActionIcon(action.id);
  return {
    id: action.id,
    label: translate(action.label),
    ...(action.style !== undefined && { style: action.style }),
    ...(actionIcon !== undefined && { icon: actionIcon }),
    ...(action.confirm !== undefined && { confirm: translate(action.confirm) }),
    ...(action.confirmLabel !== undefined && {
      confirmLabel: translate(action.confirmLabel),
    }),
    onTrigger: async () => {
      const result = await dispatcher.write(action.handler, action.payload ?? {});
      if (!result.isSuccess) {
        throw new WriteFailedError(result.error, dispatcherErrorText(result.error, translate));
      }
      await refetchAfterWrite(refetch);
    },
  };
}

// Shared by entityList, projectionList, and relatedList toolbars so the
// three call sites can't drift apart.
export function buildProjectionToolbarActions(options: {
  readonly toolbarActions: readonly RelatedListToolbarAction[] | undefined;
  readonly translate: Translate;
  readonly dispatcher: Dispatcher | undefined;
  readonly nav: NavApi;
  readonly refetch: () => Promise<unknown>;
  /** Omitted callers drop drawer-kind toolbar actions and get a dev warning,
   *  mirroring the rowActions behavior above. */
  readonly openDrawer?: OpenToolbarDrawer;
  /** Search params set on the target after a navigate-kind action, e.g. a
   *  relatedList's parent id for create-form prefill. */
  readonly navigatePrefill?: Readonly<Record<string, unknown>>;
  /** The relatedList's parent record — only a relatedList caller has one.
   *  Enables `visible`/`params` (RelatedListToolbarAction), evaluated
   *  against it exactly like header actions/RowAction.visible. Plain
   *  entityList/projectionList toolbars have no record and omit this. */
  readonly record?: Readonly<Record<string, unknown>>;
}): readonly ToolbarActionButton[] | undefined {
  const {
    toolbarActions,
    translate,
    dispatcher,
    nav,
    refetch,
    openDrawer,
    navigatePrefill,
    record,
  } = options;
  if (toolbarActions === undefined) return undefined;
  const out: ToolbarActionButton[] = [];
  for (const action of toolbarActions) {
    if (
      action.visible !== undefined &&
      record !== undefined &&
      !evalFieldCondition(action.visible, record)
    ) {
      continue;
    }
    if (action.kind === "navigate") {
      out.push(buildNavigateToolbarAction(action, translate, nav, navigatePrefill, record));
      continue;
    }
    if (action.kind === "drawer") {
      if (openDrawer === undefined) {
        warnDrawerActionDropped("toolbarAction", action.id);
        continue;
      }
      out.push(buildDrawerToolbarAction(action, translate, openDrawer));
      continue;
    }
    // writeHandler — skip without a dispatcher instead of crashing (same as rowActions).
    if (dispatcher === undefined) continue;
    out.push(buildWriteHandlerToolbarAction(action, translate, refetch, dispatcher));
  }
  return out.length > 0 ? out : undefined;
}
