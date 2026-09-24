import type {
  EntityEditScreenDefinition,
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
import { resolveActionIcon } from "@cosmicdrift/kumiko-types/action-icon";
import type { IconKey } from "@cosmicdrift/kumiko-types/nav-icon";
import type { RenderEditAction } from "../components/render-edit-types";
import type { ToolbarActionButton } from "../components/render-list";
import type { DataTableRowAction } from "../primitives";
import type { NavApi, ScreenTarget } from "./nav";
import { lastSegment } from "./qn";
import { navigateWithReturnTo, type ReturnHost } from "./return-to";
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
  host: ReturnHost | undefined,
): void {
  if (action.entity !== undefined) {
    const id = action.entityId !== undefined ? String(row.values[action.entityId] ?? "") : "";
    // skip: no entityId column on this row — nothing to navigate to.
    if (id === "") return;
    nav.navigate({ entity: action.entity, id });
    const params =
      action.params !== undefined ? evalRowExtractor(action.params, row.values) : undefined;
    if (params !== undefined) {
      nav.setSearchParams(stringifyNavParams(params));
    }
  } else if (action.screen !== undefined) {
    const entityId =
      action.entityId !== undefined ? String(row.values[action.entityId] ?? "") : undefined;
    const target: ScreenTarget = {
      screenId: action.screen,
      ...(entityId !== undefined && entityId !== "" && { entityId }),
    };
    const params =
      action.params !== undefined
        ? stringifyNavParams(evalRowExtractor(action.params, row.values))
        : undefined;
    navigateWithReturnTo(nav, target, host, params);
  }
  // skip: neither entity nor screen set — the boot-validator rejects this
  // shape (resolveRowActionNavigateTarget), so this only guards types.
}

function buildNavigateRowAction(
  action: RowActionNavigate,
  translate: Translate,
  nav: NavApi,
  host: ReturnHost | undefined,
): DataTableRowAction {
  const { visible } = action;
  const actionIcon = resolveActionIcon(action.id, action.icon);
  return {
    id: action.id,
    label: translate(action.label),
    ...(action.style !== undefined && { style: action.style }),
    confirmRequired: false,
    ...(actionIcon !== undefined && { icon: actionIcon }),
    onTrigger: (row: ListRowViewModel) => runProjectionRowNavigate(nav, action, row, host),
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
  readonly host: ReturnHost | undefined;
}): readonly DataTableRowAction[] | undefined {
  const {
    rowActions,
    translate,
    dispatcher,
    nav,
    refetch,
    openDrawer,
    defaultEditRowAction,
    host,
  } = options;
  const effectiveActions = mergeDefaultEditAction(rowActions, defaultEditRowAction);
  if (effectiveActions.length === 0) return undefined;
  const out: DataTableRowAction[] = [];
  for (const action of effectiveActions) {
    if (action.kind === "navigate") {
      out.push(buildNavigateRowAction(action, translate, nav, host));
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
  host: ReturnHost | undefined,
  prefill: Readonly<Record<string, unknown>> | undefined,
  record: Readonly<Record<string, unknown>> | undefined,
): ToolbarActionButton {
  const actionIcon = resolveActionIcon(action.id);
  const target: ScreenTarget = { screenId: action.screen };
  return {
    id: action.id,
    label: translate(action.label),
    ...(action.style !== undefined && { style: action.style }),
    confirmRequired: false,
    ...(actionIcon !== undefined && { icon: actionIcon }),
    onTrigger: () => {
      // A declared `params` extractor (evaluated against the relatedList's
      // parent record) replaces the caller's implicit prefill (e.g. a
      // relatedList's `{ [parentParam]: parentId }` or, with `parentFilter`
      // set, `{ [parentFilter.field]: parentId }`) rather than merging
      // with it — same "params present → drop the default" rule as
      // rowActions.
      const resolvedParams =
        action.params !== undefined && record !== undefined
          ? evalRowExtractor(action.params, record)
          : prefill;
      const params = resolvedParams !== undefined ? stringifyNavParams(resolvedParams) : undefined;
      navigateWithReturnTo(nav, target, host, params);
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
  readonly host: ReturnHost | undefined;
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
    host,
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
      out.push(buildNavigateToolbarAction(action, translate, nav, host, navigatePrefill, record));
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

function buildNavigateRecordAction(
  action: RowActionNavigate,
  options: {
    readonly record: Readonly<Record<string, unknown>>;
    readonly translate: Translate;
    readonly nav: NavApi;
    readonly host: ReturnHost | undefined;
    readonly actionIcon: IconKey | undefined;
    readonly defaultScreenTargetEntityId: string | undefined;
    readonly sameEntityScreenId: ((targetScreen: string) => string | undefined) | undefined;
  },
): RenderEditAction | undefined {
  const {
    record,
    translate,
    nav,
    host,
    actionIcon,
    defaultScreenTargetEntityId,
    sameEntityScreenId,
  } = options;
  const runParams = (): void => {
    const params =
      action.params !== undefined ? evalRowExtractor(action.params, record) : undefined;
    if (params !== undefined) nav.setSearchParams(stringifyNavParams(params));
  };
  if (action.entity !== undefined) {
    const targetEntity = action.entity;
    const id = action.entityId !== undefined ? String(record[action.entityId] ?? "") : "";
    return {
      id: action.id,
      label: translate(action.label),
      ...(action.style !== undefined && { style: action.style }),
      confirmRequired: false,
      ...(actionIcon !== undefined && { icon: actionIcon }),
      onPress: () => {
        // No entityId on record (id === "") → nothing to navigate to.
        if (id !== "") {
          nav.navigate({ entity: targetEntity, id });
          runParams();
        }
      },
    };
  }
  if (action.screen !== undefined) {
    const explicit =
      action.entityId !== undefined ? String(record[action.entityId] ?? "") : undefined;
    const fallback = sameEntityScreenId?.(action.screen) ?? defaultScreenTargetEntityId;
    const navEntityId = explicit ?? fallback;
    const targetScreen = action.screen;
    return {
      id: action.id,
      label: translate(action.label),
      ...(action.style !== undefined && { style: action.style }),
      confirmRequired: false,
      ...(actionIcon !== undefined && { icon: actionIcon }),
      onPress: () => {
        const target: ScreenTarget = {
          screenId: targetScreen,
          ...(navEntityId !== undefined && navEntityId !== "" && { entityId: navEntityId }),
        };
        const params =
          action.params !== undefined
            ? stringifyNavParams(evalRowExtractor(action.params, record))
            : undefined;
        navigateWithReturnTo(nav, target, host, params);
      },
    };
  }
  return undefined;
}

function buildDrawerRecordAction(
  action: RowActionDrawer,
  options: {
    readonly record: Readonly<Record<string, unknown>>;
    readonly translate: Translate;
    readonly actionIcon: IconKey | undefined;
    readonly openDrawer: (
      action: RowActionDrawer,
      initialValues: Readonly<Record<string, unknown>> | undefined,
    ) => void;
  },
): RenderEditAction {
  const { record, translate, actionIcon, openDrawer } = options;
  return {
    id: action.id,
    label: translate(action.label),
    ...(action.style !== undefined && { style: action.style }),
    confirmRequired: false,
    ...(actionIcon !== undefined && { icon: actionIcon }),
    onPress: () => {
      const initialValues =
        action.params !== undefined ? evalRowExtractor(action.params, record) : undefined;
      openDrawer(action, initialValues);
    },
  };
}

function buildWriteHandlerRecordAction(
  action: RowActionWriteHandler,
  options: {
    readonly record: Readonly<Record<string, unknown>>;
    readonly translate: Translate;
    readonly actionIcon: IconKey | undefined;
    readonly dispatcher: Dispatcher;
    readonly onWriteSuccess: () => void | Promise<void>;
  },
): RenderEditAction {
  const { record, translate, actionIcon, dispatcher, onWriteSuccess } = options;
  return {
    id: action.id,
    label: translate(action.label),
    ...(action.style !== undefined && { style: action.style }),
    ...(actionIcon !== undefined && { icon: actionIcon }),
    ...(action.confirm !== undefined && { confirm: translate(action.confirm) }),
    ...(action.confirmLabel !== undefined && {
      confirmLabel: translate(action.confirmLabel),
    }),
    onPress: async () => {
      const payload =
        action.payload !== undefined
          ? evalRowExtractor(action.payload, record)
          : { id: record["id"] };
      const result = await dispatcher.write(action.handler, payload);
      if (!result.isSuccess) {
        throw new WriteFailedError(result.error, dispatcherErrorText(result.error, translate));
      }
      await onWriteSuccess();
    },
  };
}

// Shared builder for a RowAction[] evaluated against one "record"
// context (not a specific list row) — a head card's `screen.actions`, an
// entityEdit's own `screen.actions`, and any section-level
// `actions`/`emptyState.action` are all this same shape: a RowAction
// resolved against the record currently being viewed/edited, independent of
// any table row.
export function buildRecordActions(options: {
  readonly actions: readonly RowAction[];
  readonly record: Readonly<Record<string, unknown>>;
  readonly translate: Translate;
  readonly nav: NavApi;
  readonly host: ReturnHost | undefined;
  readonly dispatcher: Dispatcher | undefined;
  readonly openDrawer: (
    action: RowActionDrawer,
    initialValues: Readonly<Record<string, unknown>> | undefined,
  ) => void;
  /** Called after a writeHandler action succeeds (refetch/reload). */
  readonly onWriteSuccess: () => void | Promise<void>;
  /** Screen-target navigate default entityId when the action declares no
   *  explicit `entityId` field-source. A caller editing a fixed entity can
   *  pass its own `entityId` here directly (the record it already is). A
   *  caller whose shown record may differ from the navigate target's entity
   *  resolves this per-target via `sameEntityScreenId` instead. */
  readonly defaultScreenTargetEntityId?: string;
  /** Given a navigate action's target screen id, returns the record id to
   *  default to IF that screen edits the same entity the current record
   *  belongs to (cross-feature lookup) — undefined otherwise. Omitted by
   *  callers with no such cross-screen lookup. */
  readonly sameEntityScreenId?: (targetScreen: string) => string | undefined;
}): readonly RenderEditAction[] | undefined {
  const {
    actions,
    record,
    translate,
    nav,
    host,
    dispatcher,
    openDrawer,
    onWriteSuccess,
    defaultScreenTargetEntityId,
    sameEntityScreenId,
  } = options;
  const out: RenderEditAction[] = [];
  for (const action of actions) {
    if (action.visible !== undefined && !evalFieldCondition(action.visible, record)) continue;
    const actionIcon = resolveActionIcon(action.id, action.icon);
    if (action.kind === "navigate") {
      const built = buildNavigateRecordAction(action, {
        record,
        translate,
        nav,
        host,
        actionIcon,
        defaultScreenTargetEntityId,
        sameEntityScreenId,
      });
      if (built !== undefined) out.push(built);
      continue;
    }
    if (action.kind === "drawer") {
      out.push(buildDrawerRecordAction(action, { record, translate, actionIcon, openDrawer }));
      continue;
    }
    // writeHandler — skip without a dispatcher instead of crashing.
    if (dispatcher === undefined) continue;
    out.push(
      buildWriteHandlerRecordAction(action, {
        record,
        translate,
        actionIcon,
        dispatcher,
        onWriteSuccess,
      }),
    );
  }
  return out.length > 0 ? out : undefined;
}
