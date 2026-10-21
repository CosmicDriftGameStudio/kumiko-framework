import type {
  EntityDefinition,
  EntityEditScreenDefinition,
  RowAction,
  RowActionWriteHandler,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { evalFieldCondition, isRecordLocked } from "@cosmicdrift/kumiko-framework/ui-types";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { extractCreatedId } from "../components/reference-create-dialog.tsx";
import {
  RenderEdit,
  type RenderEditAction,
  type RenderEditControls,
} from "../components/render-edit.tsx";
import { useDispatcher } from "../context/dispatcher-context.tsx";
import { useUserRoles } from "../context/user-roles-context.tsx";
import { useOptionalCurrentUser } from "../current-user.tsx";
import type { FormValues, SubmitResult, Translate } from "../headless/index.ts";
import { useQuery } from "../hooks/use-query.ts";
import { useOptionalTimeZone, useTranslation } from "../i18n.tsx";
import { usePrimitives } from "../primitives.tsx";
import { screenFillsHeight } from "../screen-fills-height.ts";
import { DrawerHost, useDrawerAction } from "./action-form-body.tsx";
import { useAppFeatures } from "./app-features-context.tsx";
import { useClientActionRuntime } from "./client-actions.tsx";
import { applyEditPrefill } from "./edit-prefill.ts";
import {
  buildInitialValues,
  mergeSearchParamsIntoInitial,
  tenantCurrencyMoneyFieldNames,
  useMoneyCurrencyOverrides,
  versionOf,
} from "./entity-edit-prefill.ts";
import type { FeatureSchema } from "./feature-schema.ts";
import { buildFormSchema } from "./form-schema.ts";
import { layoutEditFields, layoutFieldNames } from "./layout-fields.ts";
import { useInitialValuesHandoff, useNav } from "./nav.tsx";
import { lastSegment, toKebab } from "./qn.ts";
import { QueryErrorBanner, QueryLoadingBanner } from "./query-state-banners.tsx";
import {
  navigateToReturn,
  navigateToReturnOr,
  useReturnHost,
  useReturnTarget,
} from "./return-to.tsx";
import { buildRecordActions } from "./row-actions.ts";
import {
  entityQueryCommand,
  entityWriteCommand,
  findEntityListScreen,
  isEntityEditScreenOfOtherEntity,
  navigateAfterRedirect,
  navigateToRedirectTarget,
  overlayUpdatedProjection,
  type PagedRows,
  RecordNotFoundState,
  resolveRedirectTarget,
  returnToWinsOverRedirect,
  useNavigateToListAfter,
} from "./screen-shared.tsx";

// Shared by the update payload shape and the server-error path prefix so both can't drift.
const UPDATE_CHANGES_KEY = "changes";

export function EntityEditScreen({
  schema,
  screen,
  translate,
  entityId,
  onCopyLink,
}: {
  readonly schema: FeatureSchema;
  readonly screen: EntityEditScreenDefinition;
  readonly translate?: Translate;
  readonly entityId?: string;
  readonly onCopyLink?: () => Promise<void> | void;
}): ReactNode {
  const { Banner, Text } = usePrimitives();
  const entity = schema.entities[screen.entity];
  if (!entity) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-entity-missing">
        Entity <Text variant="code">{screen.entity}</Text> referenced by screen{" "}
        <Text variant="code">{screen.id}</Text> not registered in the schema.
      </Banner>
    );
  }
  // Split into create-body / update-body so the update-only hooks
  // (useQuery(detail)) don't fire in create mode, and vice versa.
  // Same shape as EntityListScreen.
  if (entityId !== undefined) {
    return (
      <EntityEditUpdateBody
        schema={schema}
        screen={screen}
        entity={entity}
        entityId={entityId}
        {...(translate !== undefined && { translate })}
        {...(onCopyLink !== undefined && { onCopyLink })}
      />
    );
  }
  if (screen.singleton === true) {
    return (
      <EntityEditSingletonBody
        schema={schema}
        screen={screen}
        entity={entity}
        {...(translate !== undefined && { translate })}
        {...(onCopyLink !== undefined && { onCopyLink })}
      />
    );
  }
  return (
    <EntityEditCreateOrDisabled
      schema={schema}
      screen={screen}
      entity={entity}
      {...(translate !== undefined && { translate })}
    />
  );
}

function EntityEditCreateBody({
  schema,
  screen,
  entity,
  translate,
  onSaved,
}: {
  readonly schema: FeatureSchema;
  readonly screen: EntityEditScreenDefinition;
  readonly entity: EntityDefinition;
  readonly translate?: Translate;
  // Singleton screens (kumiko-screen#1944) run without a wrapping
  // entityList screen, so `navigateToList` below is a silent no-op there —
  // without this callback, a successful create left the form stuck showing
  // the just-submitted values, and a second submit created a duplicate
  // record. Wired by EntityEditSingletonBody to re-run its list(limit:1)
  // query, which flips the branch to EntityEditUpdateBody once it sees the
  // new row.
  readonly onSaved?: () => void;
}): ReactNode {
  const nav = useNav();
  const handoffValues = useInitialValuesHandoff(screen.id);
  const appFeatures = useAppFeatures();
  const returnTargetParam = useReturnTarget(screen.id);
  // A singleton stays on its own screen after saving (onSaved/refetch) —
  // returnTo would fight that.
  const returnTarget = screen.singleton === true ? undefined : returnTargetParam;
  const entityDefaultCurrency = entity.defaultCurrency ?? "EUR";
  // A money field declaring `currency: { kind: "tenant" }` (fw#2933) resolves
  // its empty-value currency from the tenant-settings config key instead of
  // entityDefaultCurrency — `enabled` keeps the query a no-op for entities
  // without any such field.
  const tenantCurrencyFieldNames = useMemo(
    () => tenantCurrencyMoneyFieldNames(entity.fields),
    [entity.fields],
  );
  const { overrides: moneyCurrencyOverrides, loading: currencyLoading } = useMoneyCurrencyOverrides(
    entity.fields,
    tenantCurrencyFieldNames,
    entityDefaultCurrency,
  );
  const currentUser = useOptionalCurrentUser();
  const fallbackTimeZone = useOptionalTimeZone();
  const initial = useMemo(
    () =>
      applyEditPrefill(
        mergeSearchParamsIntoInitial(entity.fields, {
          searchParams: nav.searchParams,
          urlPrefillFields: screen.urlPrefillFields,
          renderableFields: layoutFieldNames(screen),
          defaultCurrency: entityDefaultCurrency,
          ...(moneyCurrencyOverrides !== undefined && { moneyCurrencyOverrides }),
          ...(handoffValues !== undefined && { handoffValues }),
        }),
        layoutEditFields(screen),
        { now: new Date(), fallbackTimeZone, user: currentUser },
      ),
    [
      entity.fields,
      nav.searchParams,
      screen,
      entityDefaultCurrency,
      moneyCurrencyOverrides,
      handoffValues,
      currentUser,
      fallbackTimeZone,
    ],
  );
  const formSchema = useMemo(() => buildFormSchema(entity, screen, "create"), [entity, screen]);
  const writeCommand = entityWriteCommand(schema.featureName, screen.entity, "create");
  const navigateToList = useNavigateToListAfter(schema, screen.entity);
  const handleCancel = useCallback(
    () => navigateToReturnOr(nav, returnTarget, navigateToList),
    [nav, returnTarget, navigateToList],
  );
  // Create's write-handler success payload doesn't flatly expose a parent FK
  // (`{ kind, id, data, … }`), so an object-form redirect's `idFrom` falls
  // back to the values just submitted to the handler.
  const controlsRef = useRef<RenderEditControls<FormValues> | null>(null);
  const handleControlsReady = useCallback((controls: RenderEditControls<FormValues>) => {
    controlsRef.current = controls;
  }, []);
  const handleSubmitted = useCallback(
    (result: SubmitResult<unknown>) => {
      if (!result.isSuccess) return;
      const redirect = screen.redirect;
      if (redirect !== undefined) {
        if (returnToWinsOverRedirect(returnTarget, redirect, schema, appFeatures)) {
          navigateToReturn(nav, returnTarget);
        } else if (typeof redirect === "string") {
          // String form unchanged: always carries the newly created
          // record's own id, regardless of the target screen's type. The
          // object form resolves like actionForm's — a child record's own id
          // is useless for a parent-detail redirect.
          const entityId = extractCreatedId(result.data);
          nav.navigate({
            screenId: lastSegment(redirect),
            ...(entityId !== undefined && { entityId }),
          });
        } else {
          navigateToRedirectTarget(
            nav,
            resolveRedirectTarget(
              redirect,
              result.data,
              schema,
              appFeatures,
              controlsRef.current?.getValues(),
            ),
          );
        }
      } else {
        navigateToReturnOr(nav, returnTarget, navigateToList);
        onSaved?.();
      }
    },
    [nav, screen.redirect, schema, appFeatures, navigateToList, onSaved, returnTarget],
  );
  // Never seed a tenant-declared money field with entityDefaultCurrency while
  // its real tenant currency is still in flight (fw#2933) — wait instead.
  if (currencyLoading) {
    return <QueryLoadingBanner />;
  }
  // Deliberately no `actions` prop here: `screen.actions` targets an
  // EXISTING record (publish/archive/duplicate and friends), which the
  // create branch has none of yet — see EntityEditUpdateForm for the
  // wired-up counterpart.
  return (
    <RenderEdit
      screen={screen}
      entity={entity}
      featureName={schema.featureName}
      initial={initial}
      schema={formSchema}
      writeCommand={writeCommand}
      onSubmit={handleSubmitted}
      onControlsReady={handleControlsReady}
      onCancel={handleCancel}
      {...(screenFillsHeight(screen) && { fillScreenHeight: true })}
      {...(screen.submitLabel !== undefined && { submitLabel: screen.submitLabel })}
      {...(translate !== undefined && { translate })}
    />
  );
}

// Update body: loads the existing record via `<feature>:query:<entity>:detail`,
// then mounts a form pre-filled with the server values and dispatches
// `<feature>:write:<entity>:update` on submit. `buildPayload` shapes the
// snapshot into Kumiko's update-event envelope `{ id, version, changes }`.
function EntityEditUpdateBody({
  schema,
  screen,
  entity,
  entityId,
  translate,
  onCopyLink,
  autoReloadOnSave,
  onDeleted,
}: {
  readonly schema: FeatureSchema;
  readonly screen: EntityEditScreenDefinition;
  readonly entity: EntityDefinition;
  readonly entityId: string;
  readonly translate?: Translate;
  readonly onCopyLink?: () => Promise<void> | void;
  // Singleton screens (kumiko-screen#1944): `navigateToList` below is a
  // no-op there (no wrapping entityList screen), so a successful update
  // left the form holding the now-stale `recordVersion` it captured at
  // mount — the next submit hit a version conflict. Set by
  // EntityEditSingletonBody to re-fetch this body's own detail query after
  // a successful save, remounting the form (via the version-keyed `key`
  // below) with the fresh version.
  readonly autoReloadOnSave?: boolean;
  // Wired by EntityEditSingletonBody to re-run its list(limit:1) query
  // after a successful delete, so the branch flips back to the create form
  // instead of the update form continuing to display the deleted record.
  readonly onDeleted?: () => void;
}): ReactNode {
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const detailQn = `${toKebab(schema.featureName)}:query:${toKebab(screen.entity)}:detail`;
  const detailQuery = useQuery<Readonly<Record<string, unknown>>>(detailQn, { id: entityId });
  const nav = useNav();
  const navigateToList = useNavigateToListAfter(schema, screen.entity);
  const returnTargetParam = useReturnTarget(screen.id);
  const returnTarget = screen.singleton === true ? undefined : returnTargetParam;

  if (detailQuery.loading && detailQuery.data === null) {
    return <QueryLoadingBanner />;
  }
  if (detailQuery.error && detailQuery.data === null) {
    return (
      <QueryErrorBanner
        error={detailQuery.error}
        translate={effectiveTranslate}
        onRetry={detailQuery.refetch}
      />
    );
  }
  // A failed refetch keeps the last good data on screen.
  const refetchErrorBanner = detailQuery.error ? (
    <QueryErrorBanner
      error={detailQuery.error}
      translate={effectiveTranslate}
      onRetry={detailQuery.refetch}
    />
  ) : null;
  const record = detailQuery.data;
  if (!record) {
    const onBack =
      returnTarget !== undefined || findEntityListScreen(schema, screen.entity) !== undefined
        ? () => navigateToReturnOr(nav, returnTarget, navigateToList)
        : undefined;
    return (
      <RecordNotFoundState
        translate={effectiveTranslate}
        {...(onBack !== undefined && { onBack })}
      />
    );
  }
  // Record version as React key: on "Reload" the detail query refetches,
  // returns a new version and the form remounts completely. Without the
  // key change the useForm controller (lifetime-scoped) would stay on the
  // original version, buildPayload would keep stamping the stale version
  // and the conflict recovery would be broken.
  const recordKey = versionOf(record);
  return (
    <>
      {refetchErrorBanner}
      <EntityEditUpdateForm
        key={`${entityId}:${recordKey}`}
        schema={schema}
        screen={screen}
        entity={entity}
        entityId={entityId}
        record={record}
        onReload={detailQuery.refetch}
        {...(translate !== undefined && { translate })}
        {...(onCopyLink !== undefined && { onCopyLink })}
        {...(autoReloadOnSave === true && { onSaved: () => void detailQuery.refetch() })}
        {...(onDeleted !== undefined && { onDeleted })}
      />
    </>
  );
}

function EntityEditUpdateForm({
  schema,
  screen,
  entity,
  entityId,
  record,
  onReload,
  translate,
  onCopyLink,
  onSaved,
  onDeleted,
}: {
  readonly schema: FeatureSchema;
  readonly screen: EntityEditScreenDefinition;
  readonly entity: EntityDefinition;
  readonly entityId: string;
  readonly record: Readonly<Record<string, unknown>>;
  readonly onReload: () => Promise<void> | void;
  readonly translate?: Translate;
  readonly onCopyLink?: () => Promise<void> | void;
  // See EntityEditUpdateBody's autoReloadOnSave/onDeleted docs — both are
  // no-ops unless the caller (singleton screens) wires them.
  readonly onSaved?: () => void;
  readonly onDeleted?: () => void;
}): ReactNode {
  // Seed the form with the server values for the entity's declared
  // fields; anything else (id, tenant_id, created_at…) stays out of
  // the form and lives in the closure. The record's `version` is
  // captured once and stamped into every update payload — if a
  // concurrent writer bumps it, the server returns a version-conflict
  // error and the user reloads.
  const recordVersion = versionOf(record);
  const entityDefaultCurrency = entity.defaultCurrency ?? "EUR";
  // A money field declaring `currency: { kind: "tenant" }` (fw#2933) resolves
  // its empty-value currency from the tenant-settings config key instead of
  // entityDefaultCurrency — `enabled` keeps the query a no-op for entities
  // without any such field. A record's own stored value (below) always wins
  // over this, regardless of the declaration.
  //
  // Only fields the record itself has no value for need the fetch at all —
  // an already-set tenant-declared field keeps its own stored currency and
  // must never block the form on this query.
  const tenantCurrencyFieldNames = useMemo(
    () =>
      tenantCurrencyMoneyFieldNames(entity.fields).filter(
        (name) => record[name] === null || record[name] === undefined,
      ),
    [entity.fields, record],
  );
  const { overrides: moneyCurrencyOverrides, loading: currencyLoading } = useMoneyCurrencyOverrides(
    entity.fields,
    tenantCurrencyFieldNames,
    entityDefaultCurrency,
  );
  const initial = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const name of Object.keys(entity.fields)) {
      out[name] =
        record[name] ??
        buildInitialValues(
          { [name]: entity.fields[name] },
          entityDefaultCurrency,
          moneyCurrencyOverrides,
        )[name];
    }
    return out;
  }, [entity.fields, entityDefaultCurrency, moneyCurrencyOverrides, record]);

  const formSchema = useMemo(
    () => buildFormSchema(entity, screen, "update", initial),
    [entity, screen, initial],
  );

  // Hand extension values (e.g. customFields jsonb) to the extension sections
  // so they show the existing data on edit instead of being write-only.
  const extensionInitialValues = useMemo((): Readonly<Record<string, unknown>> | undefined => {
    const cf = record["customFields"];
    return isPlainObject(cf) ? cf : undefined;
  }, [record]);

  const writeCommand = entityWriteCommand(schema.featureName, screen.entity, "update");
  const deleteCommand = entityWriteCommand(schema.featureName, screen.entity, "delete");
  const buildPayload = useMemo(
    () =>
      (snap: { readonly changes: Readonly<Record<string, unknown>> }): unknown => ({
        id: entityId,
        version: recordVersion,
        [UPDATE_CHANGES_KEY]: snap.changes,
      }),
    [entityId, recordVersion],
  );

  const [formDirty, setFormDirty] = useState(false);
  const nav = useNav();
  const appFeatures = useAppFeatures();
  const dispatcher = useDispatcher();
  const clientActions = useClientActionRuntime();
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const navigateToList = useNavigateToListAfter(schema, screen.entity);
  const userRoles = useUserRoles();
  const host = useReturnHost();
  const returnTargetParam = useReturnTarget(screen.id);
  // A singleton stays on its own screen after saving (onSaved/refetch) —
  // returnTo would fight that.
  const returnTarget = screen.singleton === true ? undefined : returnTargetParam;
  const { drawerAction, drawerScreen, drawerInitialValues, openDrawer, closeDrawer } =
    useDrawerAction(schema);
  // Header action buttons (fw entityEdit-actions) — same shape/dispatch
  // pattern as ProjectionDetailBody.headerActions above (the edited record
  // stands in for the "row"), minus the cross-feature defaultEditAction
  // lookup that doesn't apply here (this screen already IS the edit form).
  const handleRecordLeft = useCallback(
    (action: RowActionWriteHandler, resultData: unknown, deletedShownRecord: boolean) => {
      // Never return onto the just-deleted record.
      const target =
        deletedShownRecord && returnTarget?.entityId === entityId ? undefined : returnTarget;
      if (deletedShownRecord) onDeleted?.();
      if (action.redirect !== undefined) {
        navigateAfterRedirect({
          nav,
          schema,
          appFeatures,
          returnTarget: target,
          redirect: action.redirect,
          resultData,
          record,
        });
        return;
      }
      navigateToReturnOr(nav, target, () => {
        if (findEntityListScreen(schema, screen.entity) !== undefined) navigateToList();
        else if (onDeleted === undefined) void onReload();
      });
    },
    [
      nav,
      schema,
      appFeatures,
      returnTarget,
      record,
      entityId,
      navigateToList,
      onDeleted,
      onReload,
      screen.entity,
    ],
  );
  const sameEntityScreenId = useCallback(
    (targetScreen: string): string | undefined =>
      isEntityEditScreenOfOtherEntity(screen.entity, targetScreen, schema, appFeatures)
        ? undefined
        : entityId,
    [screen.entity, schema, appFeatures, entityId],
  );
  const buildSectionActions = useCallback(
    (actions: readonly RowAction[]): readonly RenderEditAction[] | undefined =>
      buildRecordActions({
        actions,
        record,
        translate: effectiveTranslate,
        nav,
        host,
        dispatcher,
        openDrawer,
        onWriteSuccess: onReload,
        onRecordLeft: handleRecordLeft,
        sameEntityScreenId,
        clientActions,
        defaultWritePayloadId: entityId,
        ...(formDirty && {
          discardChanges: {
            confirm: effectiveTranslate("kumiko.form.unsavedChangesActionConfirm"),
            confirmLabel: effectiveTranslate("kumiko.form.unsavedChangesActionConfirmLabel"),
          },
        }),
      }),
    [
      formDirty,
      record,
      effectiveTranslate,
      nav,
      host,
      dispatcher,
      openDrawer,
      onReload,
      handleRecordLeft,
      sameEntityScreenId,
      clientActions,
      entityId,
    ],
  );
  const headerActions = useMemo(
    (): readonly RenderEditAction[] | undefined =>
      buildSectionActions((screen.actions ?? []).filter((a) => a.placement !== "menu")),
    [buildSectionActions, screen.actions],
  );
  const headerMenuActions = useMemo(
    (): readonly RenderEditAction[] | undefined =>
      buildSectionActions((screen.actions ?? []).filter((a) => a.placement === "menu")),
    [buildSectionActions, screen.actions],
  );
  const handleSubmitted = useCallback(
    (result: SubmitResult<unknown>) => {
      if (!result.isSuccess) return;
      const redirect = screen.redirect;
      if (redirect !== undefined) {
        // The update handler's success payload usually reports only this
        // record's own id (event-store-executor-write.ts), so a parent FK
        // named by `idFrom` falls back to the already-loaded `record`.
        navigateAfterRedirect({
          nav,
          schema,
          appFeatures,
          returnTarget,
          redirect,
          resultData: result.data,
          record: overlayUpdatedProjection(record, result.data),
        });
      } else {
        navigateToReturnOr(nav, returnTarget, navigateToList);
        onSaved?.();
      }
    },
    [nav, screen.redirect, schema, appFeatures, record, navigateToList, onSaved, returnTarget],
  );
  const handleCancel = useCallback(
    () => navigateToReturnOr(nav, returnTarget, navigateToList),
    [nav, returnTarget, navigateToList],
  );
  const handleDelete = useCallback(async () => {
    const res = await dispatcher.write(deleteCommand, { id: entityId });
    if (!res.isSuccess) return res.error;
    // Never return onto the just-deleted record.
    const target = returnTarget?.entityId !== entityId ? returnTarget : undefined;
    navigateToReturnOr(nav, target, navigateToList);
    onDeleted?.();
    return undefined;
  }, [dispatcher, deleteCommand, entityId, navigateToList, onDeleted, returnTarget, nav]);

  // Never seed a tenant-declared money field with entityDefaultCurrency while
  // its real tenant currency is still in flight (fw#2933) — wait instead. A
  // stored (non-empty) value is unaffected — it never reaches this branch's
  // fallback because `initial` above already prefers `record[name]`.
  if (currencyLoading) {
    return <QueryLoadingBanner />;
  }

  // Evaluated against the stored record only, so typing in a form can never
  // flip the screen between editable and view.
  // Either condition shows the view: the server rejects saves of a locked record
  // whatever the screen says, so a screen condition can only add read-only, never lift it.
  // A record without the lock field counts as locked (isRecordLocked), matching the server.
  const viewMode =
    (screen.readOnly !== undefined && evalFieldCondition(screen.readOnly, record)) ||
    isRecordLocked(entity.lockedWhen, record);

  return (
    <>
      <RenderEdit
        screen={screen}
        entity={entity}
        featureName={schema.featureName}
        initial={initial}
        {...(viewMode && { viewMode: true })}
        // Real route id for the extension section (set-value UI): the update
        // form deliberately keeps `id` out of the form values, so the section
        // needs it explicitly — otherwise it renders in create mode.
        entityId={entityId}
        // Stored customFields for the extension section, so editing shows the
        // persisted values instead of behaving write-only.
        extensionInitialValues={extensionInitialValues}
        schema={formSchema}
        writeCommand={writeCommand}
        payloadMode="changes"
        buildPayload={buildPayload}
        serverFieldPathPrefix={`${UPDATE_CHANGES_KEY}.`}
        onSubmit={handleSubmitted}
        onDirtyChange={setFormDirty}
        // allowDelete:false marks an entity without a CRUD delete (history is
        // kept) — without this gate the button dispatched against an
        // unregistered `<entity>:delete` handler.
        {...(screen.allowDelete !== false && !viewMode && { onDelete: handleDelete })}
        onCancel={handleCancel}
        onReload={() => void onReload()}
        {...(screenFillsHeight(screen) && { fillScreenHeight: true })}
        {...(screen.submitLabel !== undefined && { submitLabel: screen.submitLabel })}
        {...(translate !== undefined && { translate })}
        {...(onCopyLink !== undefined && { onCopyLink })}
        {...(headerActions !== undefined && { actions: headerActions })}
        {...(headerMenuActions !== undefined && { menuActions: headerMenuActions })}
        buildSectionActions={buildSectionActions}
      />
      <DrawerHost
        schema={schema}
        drawerAction={drawerAction}
        drawerScreen={drawerScreen}
        {...(drawerInitialValues !== undefined && { drawerInitialValues })}
        userRoles={userRoles}
        {...(translate !== undefined && { translate })}
        onClose={closeDrawer}
        onSuccess={() => {
          closeDrawer();
          void onReload();
        }}
      />
    </>
  );
}

// Singleton entities (`singleton: true`, exactly one record per tenant):
// EntityEditScreen reaches here only without an entityId. Resolve the
// existing record via list(limit:1) before deciding create vs update —
// otherwise every visit without an id would create another record.
function EntityEditSingletonBody({
  schema,
  screen,
  entity,
  translate,
  onCopyLink,
}: {
  readonly schema: FeatureSchema;
  readonly screen: EntityEditScreenDefinition;
  readonly entity: EntityDefinition;
  readonly translate?: Translate;
  readonly onCopyLink?: () => Promise<void> | void;
}): ReactNode {
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const listQn = entityQueryCommand(schema.featureName, screen.entity, "list");
  const listQuery = useQuery<PagedRows>(listQn, { limit: 1 });

  if (listQuery.loading && listQuery.data === null) {
    return <QueryLoadingBanner />;
  }
  if (listQuery.error && listQuery.data === null) {
    return (
      <QueryErrorBanner
        error={listQuery.error}
        translate={effectiveTranslate}
        onRetry={listQuery.refetch}
      />
    );
  }
  // A failed refetch keeps the last good data on screen.
  const refetchErrorBanner = listQuery.error ? (
    <QueryErrorBanner
      error={listQuery.error}
      translate={effectiveTranslate}
      onRetry={listQuery.refetch}
    />
  ) : null;
  const rawExistingId = listQuery.data?.rows[0]?.["id"];
  const existingId = typeof rawExistingId === "string" ? rawExistingId : undefined;
  if (existingId !== undefined) {
    return (
      <>
        {refetchErrorBanner}
        <EntityEditUpdateBody
          schema={schema}
          screen={screen}
          entity={entity}
          entityId={existingId}
          {...(translate !== undefined && { translate })}
          {...(onCopyLink !== undefined && { onCopyLink })}
          autoReloadOnSave
          onDeleted={() => void listQuery.refetch()}
        />
      </>
    );
  }
  return (
    <>
      {refetchErrorBanner}
      <EntityEditCreateOrDisabled
        schema={schema}
        screen={screen}
        entity={entity}
        {...(translate !== undefined && { translate })}
        onSaved={() => void listQuery.refetch()}
      />
    </>
  );
}

// Shared no-entityId tail for both the plain create path and the
// singleton path's empty-table fallback: `allowCreate: false` blocks
// both the same way, since a create submit there would hit an
// unregistered `<entity>:create` handler.
function EntityEditCreateOrDisabled({
  schema,
  screen,
  entity,
  translate,
  onSaved,
}: {
  readonly schema: FeatureSchema;
  readonly screen: EntityEditScreenDefinition;
  readonly entity: EntityDefinition;
  readonly translate?: Translate;
  readonly onSaved?: () => void;
}): ReactNode {
  const { Banner, Text } = usePrimitives();
  if (screen.allowCreate === false) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-create-disabled">
        Screen <Text variant="code">{screen.id}</Text> is update-only (allowCreate: false) — open it
        from a row action with an entity id.
      </Banner>
    );
  }
  return (
    <EntityEditCreateBody
      schema={schema}
      screen={screen}
      entity={entity}
      {...(translate !== undefined && { translate })}
      {...(onSaved !== undefined && { onSaved })}
    />
  );
}
