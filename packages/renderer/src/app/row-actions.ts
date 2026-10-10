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
import type { RenderEditAction } from "../components/render-edit-types.js";
import type { ToolbarActionButton } from "../components/render-list.js";
import type { DataTableRowAction } from "../primitives.js";
import type { NavApi, ScreenTarget } from "./nav.js";
import { lastSegment } from "./qn.js";
import { navigateWithReturnTo, type ReturnHost } from "./return-to.js";
import { dispatcherErrorText, WriteFailedError } from "./write-failed-error.js";

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

export function navigateActionSearchParams(
  action: RowActionNavigate,
  values: Readonly<Record<string, unknown>>,
): Record<string, string | null> | undefined {
  const params =
    action.params !== undefined
      ? stringifyNavParams(evalRowExtractor(action.params, values))
      : undefined;
  if (action.tab === undefined) return params;
  return { ...params, tab: action.tab };
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
    const params = navigateActionSearchParams(action, row.values);
    navigateWithReturnTo(nav, { entity: action.entity, id }, host, params);
  } else if (action.screen !== undefined) {
    const entityId =
      action.entityId !== undefined ? String(row.values[action.entityId] ?? "") : undefined;
    const target: ScreenTarget = {
      screenId: action.screen,
      ...(entityId !== undefined && entityId !== "" && { entityId }),
    };
    const params = navigateActionSearchParams(action, row.values);
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
    ...(action.display !== undefined && { display: action.display }),
    confirmRequired: false,
    ...(action.rowClick === true && { rowClick: true }),
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

/** @internal test-only */
export function resetDrawerActionWarningsForTests(): void {
  warnedDrawerActionIds.clear();
}

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

export function buildDrawerRowAction(
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
    ...(action.display !== undefined && { display: action.display }),
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
    ...(action.display !== undefined && { display: action.display }),
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
      const stringifiedParams =
        resolvedParams !== undefined ? stringifyNavParams(resolvedParams) : undefined;
      const params =
        action.tab === undefined ? stringifiedParams : { ...stringifiedParams, tab: action.tab };
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
    // Fail closed: a conditional action without a record to evaluate against stays hidden.
    if (
      action.visible !== undefined &&
      (record === undefined || !evalFieldCondition(action.visible, record))
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

type NavigateRecordOptions = {
  readonly record: Readonly<Record<string, unknown>>;
  readonly translate: Translate;
  readonly nav: NavApi;
  readonly host: ReturnHost | undefined;
  readonly actionIcon: IconKey | undefined;
  readonly defaultScreenTargetEntityId: string | undefined;
  readonly sameEntityScreenId: ((targetScreen: string) => string | undefined) | undefined;
};

function navigateActionBase(
  action: RowActionNavigate,
  translate: Translate,
  actionIcon: IconKey | undefined,
): Omit<RenderEditAction, "onPress"> {
  return {
    id: action.id,
    label: translate(action.label),
    ...(action.style !== undefined && { style: action.style }),
    ...(action.display !== undefined && { display: action.display }),
    confirmRequired: false,
    ...(actionIcon !== undefined && { icon: actionIcon }),
  };
}

function buildNavigateEntityAction(
  action: RowActionNavigate,
  targetEntity: string,
  options: NavigateRecordOptions,
): RenderEditAction {
  const { record, translate, nav, host, actionIcon } = options;
  const id = action.entityId !== undefined ? String(record[action.entityId] ?? "") : "";
  return {
    ...navigateActionBase(action, translate, actionIcon),
    onPress: () => {
      // No entityId on record (id === "") → nothing to navigate to.
      if (id !== "") {
        const params = navigateActionSearchParams(action, record);
        navigateWithReturnTo(nav, { entity: targetEntity, id }, host, params);
      }
    },
  };
}

function buildNavigateScreenAction(
  action: RowActionNavigate,
  targetScreen: string,
  options: NavigateRecordOptions,
): RenderEditAction {
  const {
    record,
    translate,
    nav,
    host,
    actionIcon,
    defaultScreenTargetEntityId,
    sameEntityScreenId,
  } = options;
  const explicit =
    action.entityId !== undefined ? String(record[action.entityId] ?? "") : undefined;
  const fallback = sameEntityScreenId?.(targetScreen) ?? defaultScreenTargetEntityId;
  const navEntityId = explicit ?? fallback;
  return {
    ...navigateActionBase(action, translate, actionIcon),
    onPress: () => {
      const target: ScreenTarget = {
        screenId: targetScreen,
        ...(navEntityId !== undefined && navEntityId !== "" && { entityId: navEntityId }),
      };
      const params = navigateActionSearchParams(action, record);
      navigateWithReturnTo(nav, target, host, params);
    },
  };
}

function buildNavigateRecordAction(
  action: RowActionNavigate,
  options: NavigateRecordOptions,
): RenderEditAction | undefined {
  if (action.entity !== undefined) return buildNavigateEntityAction(action, action.entity, options);
  if (action.screen !== undefined) return buildNavigateScreenAction(action, action.screen, options);
  return undefined;
}

export type DiscardChanges = {
  readonly confirm: string;
  readonly confirmLabel: string;
};

// The action's own confirm text stays first; the discard hint follows after a
// blank line so both show in the single confirm dialog.
function withDiscardHint(
  ownConfirm: string | undefined,
  discardChanges: DiscardChanges | undefined,
): string | undefined {
  if (discardChanges === undefined) return ownConfirm;
  return ownConfirm === undefined
    ? discardChanges.confirm
    : `${ownConfirm}\n\n${discardChanges.confirm}`;
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
    readonly discardChanges: DiscardChanges | undefined;
  },
): RenderEditAction {
  const { record, translate, actionIcon, openDrawer, discardChanges } = options;
  return {
    id: action.id,
    label: translate(action.label),
    ...(action.style !== undefined && { style: action.style }),
    ...(action.display !== undefined && { display: action.display }),
    confirmRequired: false,
    ...(discardChanges !== undefined && {
      confirm: discardChanges.confirm,
      confirmLabel: discardChanges.confirmLabel,
    }),
    ...(actionIcon !== undefined && { icon: actionIcon }),
    onPress: () => {
      const initialValues =
        action.params !== undefined ? evalRowExtractor(action.params, record) : undefined;
      openDrawer(action, initialValues);
    },
  };
}

// Entity delete handler QN: `<feature>:write:<entity>:delete` (see
// entityWriteCommand in kumiko-screen.tsx).
const ENTITY_DELETE_HANDLER_PATTERN = /:write:[^:]+:delete$/;

export function deletesShownRecord(
  action: RowActionWriteHandler,
  payload: Readonly<Record<string, unknown>>,
  shownRecordId: unknown,
): boolean {
  return (
    ENTITY_DELETE_HANDLER_PATTERN.test(action.handler) &&
    payload["id"] !== undefined &&
    payload["id"] === shownRecordId
  );
}

function buildWriteHandlerRecordAction(
  action: RowActionWriteHandler,
  options: {
    readonly record: Readonly<Record<string, unknown>>;
    readonly translate: Translate;
    readonly actionIcon: IconKey | undefined;
    readonly dispatcher: Dispatcher;
    readonly onWriteSuccess: () => void | Promise<void>;
    readonly defaultWritePayloadId: string | undefined;
    readonly onRecordLeft: RecordLeftHandler | undefined;
    readonly discardChanges: DiscardChanges | undefined;
  },
): RenderEditAction {
  const {
    record,
    translate,
    actionIcon,
    dispatcher,
    onWriteSuccess,
    defaultWritePayloadId,
    onRecordLeft,
    discardChanges,
  } = options;
  const shownRecordId = defaultWritePayloadId ?? record["id"];
  const confirm = withDiscardHint(
    action.confirm !== undefined ? translate(action.confirm) : undefined,
    discardChanges,
  );
  // The discard label wins: the action then also throws away the unsaved input.
  const confirmLabel =
    discardChanges?.confirmLabel ??
    (action.confirmLabel !== undefined ? translate(action.confirmLabel) : undefined);
  return {
    id: action.id,
    label: translate(action.label),
    ...(action.style !== undefined && { style: action.style }),
    ...(action.display !== undefined && { display: action.display }),
    ...(actionIcon !== undefined && { icon: actionIcon }),
    ...(confirm !== undefined && { confirm }),
    ...(confirmLabel !== undefined && { confirmLabel }),
    onPress: async () => {
      const payload =
        action.payload !== undefined
          ? evalRowExtractor(action.payload, record)
          : { id: shownRecordId };
      const result = await dispatcher.write(action.handler, payload);
      if (!result.isSuccess) {
        throw new WriteFailedError(result.error, dispatcherErrorText(result.error, translate));
      }
      const deletedShownRecord = deletesShownRecord(action, payload, shownRecordId);
      if (onRecordLeft !== undefined && (action.redirect !== undefined || deletedShownRecord)) {
        onRecordLeft(action, result.data, deletedShownRecord);
      } else {
        await onWriteSuccess();
      }
    },
  };
}

export type RecordLeftHandler = (
  action: RowActionWriteHandler,
  resultData: unknown,
  deletedShownRecord: boolean,
) => void;

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
  /** Called INSTEAD of `onWriteSuccess` when a writeHandler action succeeds
   *  and leaves the shown record (`redirect` set, or it deletes the record).
   *  Callers whose actions run on the shown record pass it; callers whose
   *  records are list rows omit it. */
  readonly onRecordLeft?: RecordLeftHandler;
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
  /** Default `{ id }` for a writeHandler action declaring no `payload`. A
   *  caller editing a fixed entity passes its route id so the payload does
   *  not depend on the loaded record carrying an `id` field. */
  readonly defaultWritePayloadId?: string;
  /** Translated hint added to the confirm of every writeHandler and drawer
   *  action (they reload or remount the surrounding form). Set while that
   *  form holds unsaved input so it is not lost silently. */
  readonly discardChanges?: DiscardChanges;
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
    onRecordLeft,
    defaultScreenTargetEntityId,
    sameEntityScreenId,
    defaultWritePayloadId,
    discardChanges,
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
      out.push(
        buildDrawerRecordAction(action, {
          record,
          translate,
          actionIcon,
          openDrawer,
          discardChanges,
        }),
      );
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
        defaultWritePayloadId,
        onRecordLeft,
        discardChanges,
      }),
    );
  }
  return out.length > 0 ? out : undefined;
}
