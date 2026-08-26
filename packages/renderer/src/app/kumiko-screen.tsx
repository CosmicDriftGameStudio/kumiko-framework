import type { ConfigCascade } from "@cosmicdrift/kumiko-framework/engine";
import type {
  ActionFormScreenDefinition,
  ConfigEditScreenDefinition,
  DashboardScreenDefinition,
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
  ListFacetSpec,
  ProjectionDetailScreenDefinition,
  ProjectionListScreenDefinition,
  RowAction,
  RowActionNavigate,
  RowActionWriteHandler,
  RowFieldExtractor,
  ScreenDefinition,
  ToolbarAction,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { evalFieldCondition } from "@cosmicdrift/kumiko-framework/ui-types";
import type {
  Command,
  FormSnapshot,
  FormValues,
  ListRowViewModel,
  SubmitResult,
  Translate,
} from "@cosmicdrift/kumiko-headless";
import { fieldLabelKey, fieldOptionLabelKey } from "@cosmicdrift/kumiko-headless";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { extractCreatedId } from "../components/reference-create-dialog";
import { RenderEdit, type RenderEditAction } from "../components/render-edit";
import { RenderList, type ToolbarActionButton } from "../components/render-list";
import { useDispatcher, useOptionalDispatcher } from "../context/dispatcher-context";
import { useUserRoles } from "../context/user-roles-context";
import { type ListSort, useListUrlState } from "../hooks/use-list-url-state";
import { useQuery } from "../hooks/use-query";
import { useTranslation } from "../i18n";
import { type DataTableFacet, type DataTableRowAction, usePrimitives } from "../primitives";
import { synthesizeActionFormEntity, synthesizeActionFormScreen } from "./action-form-shim";
import { useAppFeatures } from "./app-features-context";
import { synthesizeConfigEditEntity, synthesizeConfigEditScreen } from "./config-edit-shim";
import { useCustomScreenComponent } from "./custom-screens";
import { useDashboardBody } from "./dashboard-body";
import type { FeatureSchema } from "./feature-schema";
import { buildFormSchema } from "./form-schema";
import { layoutFieldNames } from "./layout-fields";
import { useNav } from "./nav";
import {
  synthesizeProjectionDetailEntity,
  synthesizeProjectionDetailScreen,
} from "./projection-detail-shim";
import { synthesizeProjectionEntity, synthesizeProjectionScreen } from "./projection-list-shim";
import { lastSegment, toKebab } from "./qn";
import { qualifyScreenId } from "./qualify-screen-id";
import { screenAccessAllows } from "./screen-access";
import { dispatcherErrorText, WriteFailedError } from "./write-failed-error";

function evalRowExtractor(
  extractor: RowFieldExtractor,
  row: Record<string, unknown>,
): Record<string, unknown> {
  if ("pick" in extractor) {
    return Object.fromEntries(extractor.pick.map((f) => [f, row[f]]));
  }
  return Object.fromEntries(Object.entries(extractor.map).map(([to, from]) => [to, row[from]]));
}

function isWriteHandlerRowAction(action: RowAction): action is RowActionWriteHandler {
  return action.kind === "writeHandler" || action.kind === undefined;
}

// KumikoScreen picks up a ScreenDefinition from the schema by qn and
// routes it to the right renderer based on `screen.type`. Command
// qualification (`<feature>:write:<entity>:create` etc.) happens here
// so the renderers stay command-agnostic — consistent with how the
// server-side dispatcher resolves QNs from ScreenDefinition + feature.
//
// The discriminator is `screen.type`, not a component-registry lookup
// with feature-provided overrides — that's M4's r.uiComponent feature.

export type KumikoScreenProps = {
  readonly schema: FeatureSchema;
  readonly qn: string;
  readonly translate?: Translate;
  // Optional entity-id / row-id. Meaningful for entityEdit screens — when
  // set, the edit screen loads the existing record via the detail query and
  // submits an update command (`write:<entity>:update`) instead of a create.
  // Also required for projectionDetail screens (which row to fetch — no
  // create mode exists there). For entityList/custom screens it's ignored.
  readonly entityId?: string;
  // Fires when the user clicks a row on an entityList screen. The
  // second argument is the screen's entity name, threaded through so
  // the caller's handler can navigate to `<edit screen for this
  // entity>/{row.id}` without re-deriving it. Default wiring in
  // createKumikoApp does exactly that; override to open a drawer,
  // inline-expand, etc.
  readonly onRowClick?: (row: ListRowViewModel, entityName: string) => void;
  // Copy-Link-Action auf entityEdit-Update-Screens (Issue #912). Bereits
  // vollständig gebunden (URL-Bau + Clipboard) — createKumikoApp/RoutedScreen
  // liefert die Default-Impl, dieses platform-neutrale Package baut selbst
  // keine URLs/Clipboard-Calls (guard-renderer-boundaries). Nur in
  // update-mode sichtbar (entityId muss gesetzt sein).
  readonly onCopyLink?: () => Promise<void> | void;
};

export { qualifyScreenId };

/** Mirrors qualifyScreenId for nav QNs (registry form `<feature>:nav:<short-id>`).
 *  Callers building QNs (e.g. the WorkspaceShell resolver) should use this instead of string-concat, so a QN-schema change only touches one place. */
export function qualifyNavId(featureName: string, navId: string): string {
  return `${featureName}:nav:${navId}`;
}

export { screenAccessAllows };

export function KumikoScreen({
  schema,
  qn,
  translate,
  entityId,
  onRowClick,
  onCopyLink,
}: KumikoScreenProps): ReactNode {
  const { Banner, Text } = usePrimitives();
  const userRoles = useUserRoles();
  const screen = useMemo(
    () =>
      schema.screens.find(
        (s: ScreenDefinition) => qualifyScreenId(schema.featureName, s.id) === qn,
      ),
    [schema.featureName, schema.screens, qn],
  );

  if (!screen) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-not-found">
        Screen not found: <Text variant="code">{qn}</Text>
      </Banner>
    );
  }

  if (!screenAccessAllows(screen.access, userRoles)) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-access-denied">
        Access denied: <Text variant="code">{qn}</Text>
      </Banner>
    );
  }

  switch (screen.type) {
    case "entityEdit":
      return (
        <EntityEditScreen
          schema={schema}
          screen={screen}
          translate={translate}
          {...(entityId !== undefined && { entityId })}
          {...(onCopyLink !== undefined && { onCopyLink })}
        />
      );
    case "entityList":
      return (
        <EntityListScreen
          schema={schema}
          screen={screen}
          translate={translate}
          {...(onRowClick !== undefined && { onRowClick })}
        />
      );
    case "projectionList":
      return (
        <ProjectionListBody
          schema={schema}
          screen={screen}
          translate={translate}
          {...(onRowClick !== undefined && { onRowClick })}
        />
      );
    case "projectionDetail":
      return (
        <ProjectionDetailBody
          schema={schema}
          screen={screen}
          translate={translate}
          {...(entityId !== undefined && { entityId })}
        />
      );
    case "dashboard":
      return <DashboardScreenBody screen={screen} translate={translate} />;
    case "actionForm":
      return <ActionFormBody schema={schema} screen={screen} translate={translate} />;
    case "configEdit":
      return <ConfigEditBody schema={schema} screen={screen} translate={translate} />;
    case "custom":
      return <CustomScreenBody screenId={screen.id} featureName={schema.featureName} />;
  }
}

// Injection-Body für dashboard-Screens: die Panel-Implementierung (StatCard,
// Charts) ist plattform-spezifisch und kommt aus dem DashboardBody-Context
// (renderer-web registriert die Web-Variante in createKumikoApp).
function DashboardScreenBody({
  screen,
  translate,
}: {
  readonly screen: DashboardScreenDefinition;
  readonly translate?: Translate;
}): ReactNode {
  const { Banner, Text } = usePrimitives();
  const Body = useDashboardBody();
  if (Body === undefined) {
    return (
      <Banner padded variant="info" testId="kumiko-screen-dashboard-placeholder">
        Dashboard screen <Text variant="code">{screen.id}</Text> — kein Dashboard-Body registriert
        (createKumikoApp aus <Text variant="code">kumiko-renderer-web</Text> wired ihn automatisch).
      </Banner>
    );
  }
  return <Body screen={screen} {...(translate !== undefined && { translate })} />;
}

// Lookup-Body für custom-screens: schaut die Component aus dem
// CustomScreens-Context (gefüttert von clientFeatures.components in
// createKumikoApp). Wenn weder Provider gemounted noch screenId
// registriert ist, fällt es auf einen error-Banner zurück statt leer zu
// rendern — der Screen ist per URL erreichbar sobald das Server-Feature
// gemountet ist, unabhängig davon ob ein Client-Plugin existiert
// (kumiko-framework#2025).
function CustomScreenBody({
  screenId,
  featureName,
}: {
  readonly screenId: string;
  readonly featureName: string;
}): ReactNode {
  const { Banner, Text } = usePrimitives();
  const Component = useCustomScreenComponent(screenId);
  if (Component === undefined) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-custom-placeholder">
        Custom screen <Text variant="code">{screenId}</Text> (Feature{" "}
        <Text variant="code">{featureName}</Text>) hat keine Component in{" "}
        <Text variant="code">clientFeatures.components</Text> — das Web-Client-Plugin des Features
        (siehe <Text variant="code">{featureName}/web/client-plugin.tsx</Text>) fehlt in{" "}
        <Text variant="code">clientFeatures</Text>.
      </Banner>
    );
  }
  return <Component />;
}

// ---- entity-edit ----

// Derives `<feature>:write:<entity>:<verb>` from the screen's entity
// and the schema's feature name. Matches qualifyEntityName / toKebab in
// packages/framework/src/engine/qualified-name.ts so camelCase entity
// ids (e.g. driverModel) resolve to server QNs (driver-model:create).
function entityWriteCommand(
  featureName: string,
  entity: string,
  verb: "create" | "update" | "delete",
): string {
  return `${toKebab(featureName)}:write:${toKebab(entity)}:${verb}`;
}

// Default "success → zurück zur Liste"-Navigation. Findet den ersten
// entityList-Screen für die Entity und navigiert dahin. Wird von
// Create/Update/Delete genauso verwendet — alle drei haben "fertig
// editiert, raus hier" als sinnvolles Default-Verhalten.
function useNavigateToListAfter(schema: FeatureSchema, entityName: string): () => void {
  const nav = useNav();
  return useCallback(() => {
    const list = schema.screens.find(
      (s: ScreenDefinition) => s.type === "entityList" && s.entity === entityName,
    );
    if (!list) return;
    // schema.screens.id ist QN-form (registry-stamped); nav.navigate
    // erwartet Short-Form. Sonst landet die URL doppelt-qualifiziert.
    nav.navigate({ screenId: lastSegment(list.id) });
  }, [nav, schema.screens, entityName]);
}

// Default "+ Neu"-Navigation für die List-Toolbar: findet den ersten
// entityEdit-Screen ohne entityId-Anhang und navigiert dorthin.
// Returns undefined wenn kein Edit-Screen registriert ist — RenderList
// rendert dann keinen + Neu Button.
//
// Schema-Screens kommen mit qualifizierten ids ("publicstatus:screen:
// component-edit") aus der Registry; lastSegment strippt den Prefix
// für nav.navigate (siehe ./qn.ts für Doku).
function useNavigateToCreateFor(
  schema: FeatureSchema,
  entityName: string,
): (() => void) | undefined {
  const nav = useNav();
  const editScreenId = useMemo(() => {
    // allowCreate:false = update-only Edit-Screen (Create läuft über einen
    // Lifecycle-Write) — der zählt nicht als „+ Neu"-Ziel. singleton:true
    // öffnet ohne entityId den vorhandenen Record (EntityEditSingletonBody)
    // statt eines leeren Create-Forms — zählt aus demselben Grund nicht.
    const edit = schema.screens.find(
      (s: ScreenDefinition) =>
        s.type === "entityEdit" &&
        s.entity === entityName &&
        s.allowCreate !== false &&
        s.singleton !== true,
    );
    return edit !== undefined ? lastSegment(edit.id) : undefined;
  }, [schema.screens, entityName]);
  const navigate = useCallback(() => {
    if (editScreenId !== undefined) nav.navigate({ screenId: editScreenId });
  }, [nav, editScreenId]);
  return editScreenId !== undefined ? navigate : undefined;
}

// Initial form values — respect field.default when the entity declares
// one, otherwise fall back to a type-sane empty value so controlled
// inputs have something to render. Missing this on booleans/numbers
// with a `default: true`/`default: 5` would show the form in a state
// the entity didn't ask for — subtle and easy to miss until a user
// submits and is surprised.
// `defaultCurrency` is only passed by entityEdit call sites — the money
// payload shape it enables (`{amount, currency}`) matches the entity's
// write schema (schema-builder.ts, kumiko-framework#1923). Callers outside
// that path (config-edit, action-form) synthesize their own entity and use
// money as a plain number against a different write contract, so they
// deliberately keep the old bare-`0` default by omitting the argument.
export function buildInitialValues(
  fields: Readonly<Record<string, unknown>>,
  defaultCurrency?: string,
): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(fields)) {
    const shape = def as { type?: string; default?: unknown };
    if (shape.default !== undefined) {
      out[name] = shape.default;
      continue;
    }
    if (shape.type === "money" && defaultCurrency !== undefined) {
      out[name] = { amount: 0, currency: defaultCurrency };
      continue;
    }
    out[name] =
      shape.type === "boolean"
        ? false
        : shape.type === "number" || shape.type === "money"
          ? 0
          : shape.type === "multiSelect"
            ? []
            : "";
  }
  return out;
}

export function mergeSearchParamsIntoInitial(
  fields: Readonly<Record<string, unknown>>,
  searchParams: Readonly<Record<string, string>>,
  renderableFields?: ReadonlySet<string>,
  defaultCurrency?: string,
): Record<string, unknown> {
  const defaults = buildInitialValues(fields, defaultCurrency) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...defaults };
  for (const [name, fieldDef] of Object.entries(fields)) {
    if (renderableFields !== undefined && !renderableFields.has(name)) continue;
    const shape = fieldDef as { type?: string; sensitive?: boolean };
    if (shape.sensitive === true) continue;
    const raw = searchParams[name];
    if (raw === undefined) continue;
    if (shape.type === "number") {
      const parsed = Number(raw);
      merged[name] = Number.isNaN(parsed) ? defaults[name] : parsed;
    } else if (shape.type === "money") {
      const parsed = Number(raw);
      merged[name] = Number.isNaN(parsed)
        ? defaults[name]
        : defaultCurrency !== undefined
          ? { amount: parsed, currency: defaultCurrency }
          : parsed;
    } else if (shape.type === "boolean") {
      merged[name] = raw === "true";
    } else if (shape.type === "multiSelect") {
      // Row-action navigate stringifies arrays via String(arr) → "a,b" (or
      // JSON when the navigate helper JSON.stringifies). Accept both so
      // member-roles-edit can prefill from ?roles=TenantAdmin.
      if (raw.startsWith("[")) {
        try {
          const parsed: unknown = JSON.parse(raw);
          merged[name] = Array.isArray(parsed) ? parsed.map((v) => String(v)) : defaults[name];
        } catch {
          merged[name] = defaults[name];
        }
      } else {
        merged[name] =
          raw === ""
            ? []
            : raw
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
      }
    } else {
      merged[name] = raw;
    }
  }
  return merged;
}

function EntityEditScreen({
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
  const initial = useMemo(
    () =>
      mergeSearchParamsIntoInitial(
        entity.fields,
        nav.searchParams,
        layoutFieldNames(screen),
        entity.defaultCurrency ?? "EUR",
      ) as FormValues,
    [entity.fields, nav.searchParams, screen, entity.defaultCurrency],
  );
  const formSchema = useMemo(() => buildFormSchema(entity, screen), [entity, screen]);
  const writeCommand = entityWriteCommand(schema.featureName, screen.entity, "create");
  const navigateToList = useNavigateToListAfter(schema, screen.entity);
  const handleSubmitted = useCallback(
    (result: SubmitResult<unknown>) => {
      if (!result.isSuccess) return;
      if (screen.redirect !== undefined) {
        const entityId = extractCreatedId(result.data);
        nav.navigate({
          screenId: lastSegment(screen.redirect),
          ...(entityId !== undefined && { entityId }),
        });
        return;
      }
      navigateToList();
      onSaved?.();
    },
    [nav, screen.redirect, navigateToList, onSaved],
  );
  return (
    <RenderEdit
      screen={screen}
      entity={entity}
      featureName={schema.featureName}
      initial={initial}
      schema={formSchema}
      writeCommand={writeCommand}
      onSubmit={handleSubmitted}
      onCancel={navigateToList}
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
  const { Banner, Text } = usePrimitives();
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const detailQn = `${toKebab(schema.featureName)}:query:${toKebab(screen.entity)}:detail`;
  const detailQuery = useQuery<Readonly<Record<string, unknown>>>(detailQn, { id: entityId });

  if (detailQuery.loading && detailQuery.data === null) {
    return (
      <Banner padded variant="loading" testId="kumiko-screen-loading">
        Loading…
      </Banner>
    );
  }
  if (detailQuery.error) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-error">
        {dispatcherErrorText(detailQuery.error, effectiveTranslate)}
      </Banner>
    );
  }
  const record = detailQuery.data;
  if (!record) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-record-missing">
        Record <Text variant="code">{entityId}</Text> not found.
      </Banner>
    );
  }
  // Record-version als React-key: bei "Neu laden" refetched detail,
  // liefert neue version, und das Form remountet komplett. Ohne den
  // Key-Wechsel bliebe der useForm-Controller lifetime-scoped auf
  // der ursprünglichen version sitzen — der buildPayload würde
  // weiter die stale version stampen und der Konflikt-Recovery wäre
  // kaputt.
  const recordKey = (record as { version?: number }).version ?? 1;
  return (
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
  const recordVersion = (record as { version?: number }).version ?? 1;
  const initial = useMemo(() => {
    const out: Record<string, unknown> = {};
    const defaultCurrency = entity.defaultCurrency ?? "EUR";
    for (const name of Object.keys(entity.fields)) {
      out[name] =
        record[name] ?? buildInitialValues({ [name]: entity.fields[name] }, defaultCurrency)[name];
    }
    return out as FormValues;
  }, [entity.fields, entity.defaultCurrency, record]);

  const formSchema = useMemo(() => buildFormSchema(entity, screen), [entity, screen]);

  // Extension-Werte (z.B. customFields-jsonb) an extension-sections geben,
  // damit sie beim Edit den Bestand zeigen statt write-only zu sein.
  const extensionInitialValues = useMemo((): Readonly<Record<string, unknown>> | undefined => {
    const cf = record["customFields"];
    return cf !== null && typeof cf === "object" && !Array.isArray(cf)
      ? (cf as Record<string, unknown>)
      : undefined;
  }, [record]);

  const writeCommand = entityWriteCommand(schema.featureName, screen.entity, "update");
  const deleteCommand = entityWriteCommand(schema.featureName, screen.entity, "delete");
  const buildPayload = useMemo(
    () =>
      (snap: { readonly changes: Readonly<Record<string, unknown>> }): unknown => ({
        id: entityId,
        version: recordVersion,
        changes: snap.changes,
      }),
    [entityId, recordVersion],
  );

  const nav = useNav();
  const dispatcher = useDispatcher();
  const navigateToList = useNavigateToListAfter(schema, screen.entity);
  const handleSubmitted = useCallback(
    (result: SubmitResult<unknown>) => {
      if (!result.isSuccess) return;
      if (screen.redirect !== undefined) {
        nav.navigate({ screenId: lastSegment(screen.redirect) });
        return;
      }
      navigateToList();
      onSaved?.();
    },
    [nav, screen.redirect, navigateToList, onSaved],
  );
  const handleDelete = useCallback(async () => {
    const res = await dispatcher.write(deleteCommand, { id: entityId });
    if (res.isSuccess) {
      navigateToList();
      onDeleted?.();
    }
  }, [dispatcher, deleteCommand, entityId, navigateToList, onDeleted]);

  return (
    <RenderEdit
      screen={screen}
      entity={entity}
      featureName={schema.featureName}
      initial={initial}
      // Echte route-id an die extension-section (Set-Value-UI): das
      // Update-Form lässt `id` bewusst aus den Form-values, daher braucht
      // die Section die id explizit — sonst create-mode trotz Edit.
      entityId={entityId}
      // customFields-Bestand an die extension-section, damit sie beim Edit
      // die gespeicherten Werte zeigt (nicht write-only).
      extensionInitialValues={extensionInitialValues}
      schema={formSchema}
      writeCommand={writeCommand}
      payloadMode="changes"
      buildPayload={buildPayload}
      onSubmit={handleSubmitted}
      // allowDelete:false = Entity ohne CRUD-delete (History-Erhalt) —
      // ohne das Gate dispatchte der Button gegen einen nicht
      // registrierten `<entity>:delete`-Handler.
      {...(screen.allowDelete !== false && { onDelete: handleDelete })}
      onCancel={navigateToList}
      onReload={() => void onReload()}
      {...(screen.submitLabel !== undefined && { submitLabel: screen.submitLabel })}
      {...(translate !== undefined && { translate })}
      {...(onCopyLink !== undefined && { onCopyLink })}
    />
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
  const { Banner } = usePrimitives();
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const listQn = entityQueryCommand(schema.featureName, screen.entity, "list");
  const listQuery = useQuery<PagedRows>(listQn, { limit: 1 });

  if (listQuery.loading && listQuery.data === null) {
    return (
      <Banner padded variant="loading" testId="kumiko-screen-loading">
        Loading…
      </Banner>
    );
  }
  if (listQuery.error) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-error">
        {dispatcherErrorText(listQuery.error, effectiveTranslate)}
      </Banner>
    );
  }
  const rawExistingId = listQuery.data?.rows[0]?.["id"];
  const existingId = typeof rawExistingId === "string" ? rawExistingId : undefined;
  if (existingId !== undefined) {
    return (
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
    );
  }
  return (
    <EntityEditCreateOrDisabled
      schema={schema}
      screen={screen}
      entity={entity}
      {...(translate !== undefined && { translate })}
      onSaved={() => void listQuery.refetch()}
    />
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

// ---- entity-list ----

function entityQueryCommand(featureName: string, entity: string, verb: "list"): string {
  return `${toKebab(featureName)}:query:${toKebab(entity)}:${verb}`;
}

// Server-side entity-query-handlers return the paged envelope
// `{ rows, nextCursor, total? }`. Narrow the useQuery generic to that
// shape so RenderList gets plain rows. `total` ist optional — Server
// liefert es nur wenn der Caller `totalCount: true` setzt.
type PagedRows = {
  readonly rows: Readonly<Record<string, unknown>>[];
  readonly nextCursor: string | null;
  readonly total?: number;
};

// Payload for the server-side list query handler (LIST_PAYLOAD_SCHEMA):
// search/sort/sortDirection/limit + offset/totalCount for pager mode OR
// cursor for infinite scroll. Shared by EntityListBody and
// ProjectionListBody so the two branches can't drift on this shape
// (fw#2165) — entity-only additions (screen.filter, faceted filters) are
// layered on top by the caller instead of living in here.
export function buildListQueryPayload(state: {
  readonly limit: number;
  readonly search: string;
  readonly sort: ListSort | null;
  readonly usePager: boolean;
  readonly page: number;
  readonly useInfinite: boolean;
  readonly cursor: string | undefined;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = { limit: state.limit };
  if (state.search !== "") payload["search"] = state.search;
  if (state.sort !== null) {
    payload["sort"] = state.sort.field;
    payload["sortDirection"] = state.sort.dir;
  }
  if (state.usePager) {
    // page=1 → offset=0, page=2 → offset=limit, etc. Server clamps itself
    // when offset >= total.
    const offset = (state.page - 1) * state.limit;
    if (offset > 0) payload["offset"] = offset;
    // totalCount: extra COUNT(*) so the pager can render "Page X of Y".
    payload["totalCount"] = true;
  } else if (state.useInfinite && state.cursor !== undefined) {
    payload["cursor"] = state.cursor;
  }
  return payload;
}

// One resolved facet, independent of where the type info came from — an
// entity field (entityList) or an explicit ListFacetSpec (projectionList,
// fw#2224). Shared by buildFilterFacets/buildFilterPayload below so both
// screen types build their query-payload filters and DataTable facet-UI
// through the same code, instead of two copies that can drift.
type ResolvedFacetSpec = {
  readonly field: string;
  readonly type: "select" | "boolean";
  readonly label: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
};

function buildFilterFacets(specs: readonly ResolvedFacetSpec[]): DataTableFacet[] {
  return specs.map((spec) => ({ field: spec.field, label: spec.label, options: spec.options }));
}

// User-selected faceted filters from URL-state → payload.filters. Boolean
// fields coerce "true"/"false" strings to real booleans (DB column is
// boolean); everything else stays string[] under op:"in" (multi-select
// semantics). `typeOf` resolves a field to its known type string —
// undefined means "unknown field", so it's dropped (typo-safe: a stale/
// hand-crafted URL param for an undeclared field never reaches the
// server). Deliberately NOT gated on the field being a *facet* — entityList
// passes through any field present in entity.fields, matching its
// pre-fw#2224 behavior; only the boolean-coercion branch cares about type.
function buildFilterPayload(
  urlFilters: Readonly<Record<string, readonly string[]>>,
  typeOf: (field: string) => string | undefined,
): { field: string; op: "in"; value: unknown }[] {
  const out: { field: string; op: "in"; value: unknown }[] = [];
  for (const [field, values] of Object.entries(urlFilters)) {
    if (values.length === 0) continue;
    // `id` is a base column (not a declared facet), allowed as an id-set
    // filter so a header-slot control — e.g. the tags TagFilter — can narrow
    // ANY list to a resolved set of row ids without the host declaring a facet.
    if (field === "id") {
      out.push({ field, op: "in", value: values });
      continue;
    }
    const type = typeOf(field);
    if (type === undefined) continue;
    const value = type === "boolean" ? values.map((v) => v === "true") : values;
    out.push({ field, op: "in", value });
  }
  return out;
}

// entityList adapter — one DataTableFacet per filterable select/boolean
// entity field, labels via the standard field/option i18n convention.
function resolveEntityFacetSpecs(
  fields: Readonly<Record<string, unknown>>,
  featureName: string,
  entityName: string,
  translate: Translate,
): ResolvedFacetSpec[] {
  const out: ResolvedFacetSpec[] = [];
  for (const [field, rawDef] of Object.entries(fields)) {
    // entity.fields ist am Renderer-Layer schwach getypt (Record<string,
    // unknown>, vom Schema deserialisiert) — Boundary-Cast wie buildInitialValues.
    const def = rawDef as { type?: string; filterable?: boolean; options?: readonly string[] };
    if (def.filterable !== true) continue;
    const label = translate(fieldLabelKey(featureName, entityName, field));
    if (def.type === "select" && Array.isArray(def.options)) {
      out.push({
        field,
        type: "select",
        label,
        options: def.options.map((value) => ({
          value,
          label: translate(fieldOptionLabelKey(featureName, entityName, field, value)),
        })),
      });
    } else if (def.type === "boolean") {
      out.push({
        field,
        type: "boolean",
        label,
        options: [
          {
            value: "true",
            label: translate(fieldOptionLabelKey(featureName, entityName, field, "true")),
          },
          {
            value: "false",
            label: translate(fieldOptionLabelKey(featureName, entityName, field, "false")),
          },
        ],
      });
    }
  }
  return out;
}

// projectionList adapter — a projectionList has no entity/i18n convention to
// derive labels from, so ListFacetSpec carries every label explicitly
// (fw#2224). Labels may be raw display strings or i18n keys; run them
// through translate like entity facets (passthrough when the key is missing).
function resolveProjectionFacetSpecs(
  facets: readonly ListFacetSpec[] | undefined,
  translate: Translate,
): ResolvedFacetSpec[] {
  if (facets === undefined) return [];
  return facets.map((facet) =>
    facet.type === "select"
      ? {
          field: facet.field,
          type: "select",
          label: translate(facet.label),
          options: facet.options.map((opt) => ({
            value: opt.value,
            label: translate(opt.label),
          })),
        }
      : {
          field: facet.field,
          type: "boolean",
          label: translate(facet.label),
          options: [
            { value: "true", label: translate(facet.trueLabel) },
            { value: "false", label: translate(facet.falseLabel) },
          ],
        },
  );
}

// ---- toolbarAction kind:"drawer" (fw#2225) ----
//
// Shared between EntityListBody and ProjectionListBody: state for "which
// drawer-kind toolbar action is currently open" plus a host component that
// mounts the referenced actionForm inside the Drawer primitive. Reuses
// ActionFormBody (no second, parallel form renderer) with onSuccess/
// onCancelOverride so submit-success closes the drawer + refetches the
// list instead of navigating, mirroring what a full-page actionForm would
// do via `redirect`.
type ToolbarDrawerAction = Extract<ToolbarAction, { kind: "drawer" }>;

function useToolbarDrawerAction(schema: FeatureSchema): {
  readonly drawerAction: ToolbarDrawerAction | null;
  readonly drawerScreen: ActionFormScreenDefinition | undefined;
  readonly openDrawer: (action: ToolbarDrawerAction) => void;
  readonly closeDrawer: () => void;
} {
  const [drawerAction, setDrawerAction] = useState<ToolbarDrawerAction | null>(null);
  const drawerScreen = useMemo(() => {
    if (drawerAction === null) return undefined;
    // Same same-feature, short-id resolution as runNavigate — the drawer's
    // `screen` reference is scoped to schema.screens, not cross-feature.
    return schema.screens.find(
      (s): s is ActionFormScreenDefinition =>
        s.type === "actionForm" && lastSegment(s.id) === drawerAction.screen,
    );
  }, [drawerAction, schema.screens]);
  const openDrawer = useCallback((action: ToolbarDrawerAction) => setDrawerAction(action), []);
  const closeDrawer = useCallback(() => setDrawerAction(null), []);
  return { drawerAction, drawerScreen, openDrawer, closeDrawer };
}

function ToolbarDrawerHost({
  schema,
  drawerAction,
  drawerScreen,
  userRoles,
  translate,
  onClose,
  onSuccess,
}: {
  readonly schema: FeatureSchema;
  readonly drawerAction: ToolbarDrawerAction | null;
  readonly drawerScreen: ActionFormScreenDefinition | undefined;
  readonly userRoles: readonly string[] | undefined;
  readonly translate?: Translate;
  readonly onClose: () => void;
  readonly onSuccess: () => void;
}): ReactNode {
  const { Drawer, Banner, Text } = usePrimitives();
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  // Drawer is an optional Core-Primitive (additive rollout) — same "skip +
  // warn once" precedent as rowActions without a mounted DispatcherProvider
  // above, instead of crashing when a web app hasn't upgraded its
  // createKumikoApp wiring yet.
  useEffect(() => {
    if (drawerAction !== null && Drawer === undefined) {
      // biome-ignore lint/suspicious/noConsole: dev-warning for a setup error
      console.warn(
        `[kumiko] toolbarAction "${drawerAction.id}" is kind:"drawer", but no <Drawer> primitive is registered — it will not open. createKumikoApp() from kumiko-renderer-web wires it automatically.`,
      );
    }
  }, [drawerAction, Drawer]);

  if (drawerAction === null || Drawer === undefined) return null;

  // Access mirrors kind:"navigate" exactly: the toolbar button itself stays
  // visible either way (same as navigate — access is enforced at the
  // target, not by hiding the trigger), but the drawer shows the same
  // "Access denied" state KumikoScreen's top-level gate would show for a
  // direct hit on that screen, never the form.
  const allowed = screenAccessAllows(drawerScreen?.access, userRoles);

  return (
    <Drawer
      open={true}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={effectiveTranslate(drawerAction.label)}
      testId={`toolbar-drawer-${drawerAction.id}`}
    >
      {drawerScreen === undefined ? (
        <Banner padded variant="error" testId="kumiko-toolbar-drawer-not-found">
          Screen not found: <Text variant="code">{drawerAction.screen}</Text>
        </Banner>
      ) : !allowed ? (
        <Banner padded variant="error" testId="kumiko-toolbar-drawer-access-denied">
          Access denied: <Text variant="code">{drawerAction.screen}</Text>
        </Banner>
      ) : (
        <ActionFormBody
          schema={schema}
          screen={drawerScreen}
          {...(translate !== undefined && { translate })}
          onSuccess={onSuccess}
          onCancelOverride={onClose}
        />
      )}
    </Drawer>
  );
}

function EntityListScreen({
  schema,
  screen,
  translate,
  onRowClick,
}: {
  readonly schema: FeatureSchema;
  readonly screen: EntityListScreenDefinition;
  readonly translate?: Translate;
  readonly onRowClick?: (row: ListRowViewModel, entityName: string) => void;
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
  // Entity resolved — mount the inner component so useQuery only fires
  // when there's actually something to render. A missing entity is a
  // dev-error state; no point hitting the server for it.
  return (
    <EntityListBody
      schema={schema}
      screen={screen}
      entity={entity}
      {...(translate !== undefined && { translate })}
      {...(onRowClick !== undefined && { onRowClick })}
    />
  );
}

function EntityListBody({
  schema,
  screen,
  entity,
  translate,
  onRowClick,
}: {
  readonly schema: FeatureSchema;
  readonly screen: EntityListScreenDefinition;
  readonly entity: EntityDefinition;
  readonly translate?: Translate;
  readonly onRowClick?: (row: ListRowViewModel, entityName: string) => void;
}): ReactNode {
  const featureName = schema.featureName;
  const onCreate = useNavigateToCreateFor(schema, screen.entity);
  const { Banner } = usePrimitives();
  const queryType = entityQueryCommand(featureName, screen.entity, "list");
  const nav = useNav();
  const userRoles = useUserRoles();
  const { drawerAction, drawerScreen, openDrawer, closeDrawer } = useToolbarDrawerAction(schema);

  // URL-State: sort/dir/q/page leben unter dem screen.id-Namespace
  // (`/orders?orders.sort=createdAt&orders.dir=desc&orders.q=acme`),
  // damit zwei Lists auf derselben Route nicht über dieselben
  // Query-Keys streiten. Default-Sort aus der Screen-Def gewinnt nur
  // wenn URL keinen sort hat — Author-Default vs User-Choice.
  const urlState = useListUrlState(screen.id);
  const effectiveSort = urlState.sort ?? screen.defaultSort ?? null;
  const limit = screen.pageSize ?? 50;
  const paginationMode = screen.pagination ?? "pages";
  const usePager = paginationMode === "pages";
  const useInfinite = paginationMode === "infinite";

  // Infinite-Scroll: lokaler State akkumuliert rows über mehrere
  // useQuery-Aufrufe (statt replacen wie bei Pager). cursor wechselt
  // wenn der User den Bottom-Sentinel erreicht; bei sort/q-Change
  // resetten wir alles, da die Insert-Order der akkumulierten Rows
  // sonst inkonsistent ist mit der neuen Sortierung.
  const [accumulated, setAccumulated] = useState<readonly Readonly<Record<string, unknown>>[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(true);
  // Ref damit der useEffect-Cleanup nicht alten state sieht.
  const sortQRef = useRef<string>("");
  const sortQKey = `${urlState.q}|${effectiveSort?.field ?? ""}|${effectiveSort?.dir ?? ""}`;
  // Bei sort/q-Wechsel rows + cursor reseten — vor dem nächsten useQuery
  // damit der Reload mit cursor=undefined startet.
  useEffect(() => {
    if (!useInfinite) return;
    if (sortQRef.current === sortQKey) return;
    sortQRef.current = sortQKey;
    setAccumulated([]);
    setCursor(undefined);
    setHasMore(true);
  }, [useInfinite, sortQKey]);

  // User-gewählte Faceted-Filter aus dem URL-State → payload.filters.
  // typeOf liest den Field-Type direkt aus entity.fields (nicht gated auf
  // filterable — bewusst permissiv, siehe buildFilterPayload-Doc).
  const filterPayload = useMemo(
    () =>
      buildFilterPayload(urlState.filters, (field) => {
        // entity.fields ist am Renderer-Layer schwach getypt (vom Schema
        // deserialisiert) — Boundary-Cast wie buildInitialValues.
        const def = entity.fields[field] as { type?: string } | undefined;
        return def?.type;
      }),
    [urlState.filters, entity.fields],
  );

  // Entity-only additions (screen.filter, faceted filters) layer on top of
  // the shared buildListQueryPayload — projectionList has neither.
  const queryPayload = useMemo(() => {
    const payload = buildListQueryPayload({
      limit,
      search: urlState.q,
      sort: effectiveSort,
      usePager,
      page: urlState.page,
      useInfinite,
      cursor,
    });
    // Screen-Filter (Tier 2.7c) — vom Author am Schema deklariert,
    // unabhängig vom User-q-Search. Mehrere Buckets derselben Entity
    // ("Upcoming" / "Active" / "Past") nutzen unterschiedliche filter
    // bei gleichem Query-Handler.
    if (screen.filter !== undefined) {
      payload["filter"] = screen.filter;
    }
    if (filterPayload.length > 0) {
      payload["filters"] = filterPayload;
    }
    return payload;
  }, [
    limit,
    urlState.q,
    effectiveSort,
    screen.filter,
    filterPayload,
    usePager,
    urlState.page,
    useInfinite,
    cursor,
  ]);

  const rowsQuery = useQuery<PagedRows>(queryType, queryPayload, { live: true });

  // Infinite-Scroll: bei jedem erfolgreichen Result die rows appenden +
  // hasMore aus nextCursor ableiten. Live-Updates (postgres NOTIFY) und
  // initiale Loads laufen beide hier durch — das useEffect-Dep-Array
  // pinnt die Dedup auf dem letzten verarbeiteten data-Pointer.
  const lastDataRef = useRef<PagedRows | null>(null);
  useEffect(() => {
    if (!useInfinite) return;
    const data = rowsQuery.data;
    if (data === null) return;
    if (data === lastDataRef.current) return;
    lastDataRef.current = data;
    setAccumulated((prev) => {
      // Wenn cursor undefined ist, ist das die erste Page nach
      // sort/q-Change → komplett ersetzen statt anhängen. Sonst dedupe
      // auf id falls Live-Updates einen Eintrag in der nächsten Page
      // bringen die schon angehängt war.
      if (cursor === undefined) return data.rows;
      const seen = new Set(prev.map((r) => r["id"] as string));
      const fresh = data.rows.filter((r) => !seen.has(r["id"] as string));
      return [...prev, ...fresh];
    });
    setHasMore(data.nextCursor !== null);
  }, [rowsQuery.data, useInfinite, cursor]);

  const loadMore = useCallback(() => {
    if (!useInfinite) return;
    if (rowsQuery.loading) return;
    const data = rowsQuery.data;
    if (data?.nextCursor === undefined || data.nextCursor === null) return;
    setCursor(data.nextCursor);
  }, [useInfinite, rowsQuery.loading, rowsQuery.data]);

  // RowActions: Schema-Form (handler-QN + i18n-Key) → Resolved-Form
  // (dispatcher-Call + translated Strings). dispatcher.write kennt den
  // User intern (JWT-Cookie). Schema kann sowohl raw-Strings als auch
  // i18n-Keys enthalten — translate() returnt den Key wenn das Bundle
  // ihn nicht kennt (Convention überall im Renderer).
  // Hooks-Reihenfolge: ALLE Hooks vor early-return für loading/error,
  // sonst kollidieren die Hook-Slots zwischen Renders.
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;

  // Faceted-Filter: ein Dropdown pro filterable select/boolean-Feld.
  // Labels + select-Option-Labels über dieselbe i18n-Konvention wie die
  // Spalten-Header (fieldLabelKey / :option:<value>).
  const filterFacets = useMemo<DataTableFacet[]>(
    () =>
      buildFilterFacets(
        resolveEntityFacetSpecs(entity.fields, featureName, screen.entity, effectiveTranslate),
      ),
    [entity.fields, featureName, screen.entity, effectiveTranslate],
  );

  // Soft-Dispatcher: in Tests die ohne DispatcherProvider mounten,
  // bleibt rowActions undefined statt zu crashen. Echte Apps haben
  // den Provider via createKumikoApp — wenn nicht, ist es vermutlich
  // ein Setup-Fehler, also einmal warnen damit der Author das findet
  // (sonst rendert die Action-Spalte still nichts und der "warum sind
  // meine Buttons weg?"-Debug ist teuer).
  const dispatcher = useOptionalDispatcher();
  const hasRowActions = screen.rowActions !== undefined && screen.rowActions.length > 0;
  useEffect(() => {
    if (hasRowActions && dispatcher === undefined) {
      // biome-ignore lint/suspicious/noConsole: dev-warning für Setup-Fehler
      console.warn(
        `[kumiko] Screen "${screen.id}" deklariert rowActions, aber kein <DispatcherProvider> ist mounted — die Action-Spalte wird nicht gerendert. createKumikoApp() wired den Provider automatisch.`,
      );
    }
  }, [hasRowActions, dispatcher, screen.id]);
  // Discriminated Union: writeHandler (default) dispatched einen Server-
  // Handler, navigate ruft nav.navigate() ggf. mit URL-Search-Params aus
  // params(row). nav lebt schon weiter unten in EntityListBody-Scope.
  // Gemeinsame navigate-Ausführung: sowohl das "…"-Aktionsmenü (rowActions) als
  // auch der Row-Body-Klick (rowClick) laufen hierdurch — ein Pfad, damit beide
  // nicht auseinanderdriften.
  const runNavigate = useCallback(
    (action: RowActionNavigate, row: ListRowViewModel) => {
      if (action.entity !== undefined) {
        // Entity-Targets (fw#2228) lösen sich erst in der NavApi-Impl gegen
        // ALLE Features auf (resolveTarget in renderer-web/nav.tsx) — dieses
        // Package kennt nur `schema` (das eine aufrufende Feature) und kann
        // detailFor cross-feature nicht selbst nachschlagen.
        const explicit =
          action.entityId !== undefined ? String(row.values[action.entityId] ?? "") : undefined;
        const id = explicit ?? String(row.values["id"] ?? "");
        nav.navigate({ entity: action.entity, id });
      } else if (action.screen !== undefined) {
        // Default entityId für entityEdit-Targets: row["id"] wenn kein expliziter
        // entityId-Feldname gesetzt ist. Nur für Targets DERSELBEN Entity — sonst
        // bekäme ein Cross-Entity-Edit-Screen die falsche row.id injiziert.
        const targetIsEntityEdit = schema.screens.some(
          (s) =>
            s.type === "entityEdit" &&
            s.entity === screen.entity &&
            lastSegment(s.id) === action.screen,
        );
        const explicit =
          action.entityId !== undefined ? String(row.values[action.entityId] ?? "") : undefined;
        const fallback = targetIsEntityEdit ? String(row.values["id"] ?? "") : undefined;
        const entityId = explicit ?? fallback;
        nav.navigate({
          screenId: action.screen,
          ...(entityId !== undefined && entityId !== "" && { entityId }),
        });
      }
      const params =
        action.params !== undefined ? evalRowExtractor(action.params, row.values) : undefined;
      if (params !== undefined) {
        // setSearchParams nimmt string|null — komplexe Werte zu String (der Reader
        // kennt via URL nur Strings). Known-edge: zielt die Action auf den
        // AKTUELLEN pathname, mergen die Params auf den alten ?-String (für
        // Row-Actions praktisch nicht erreichbar, Pfad differiert).
        const stringified: Record<string, string | null> = {};
        for (const [k, v] of Object.entries(params)) {
          stringified[k] =
            v === null || v === undefined ? null : Array.isArray(v) ? JSON.stringify(v) : String(v);
        }
        nav.setSearchParams(stringified);
      }
    },
    [nav, schema.screens, screen.entity],
  );

  const rowActions = useMemo(() => {
    if (screen.rowActions === undefined) return undefined;
    return screen.rowActions
      .map((action: RowAction): DataTableRowAction | null => {
        // navigate-Variante braucht keinen Dispatcher; nav ist
        // immer da (Provider von createKumikoApp).
        if (action.kind === "navigate") {
          const navigateAction = action;
          const actionVisible = action.visible;
          return {
            id: action.id,
            label: effectiveTranslate(action.label),
            ...(action.style !== undefined && { style: action.style }),
            onTrigger: (row: ListRowViewModel) => runNavigate(navigateAction, row),
            ...(actionVisible !== undefined && {
              isVisible: (row: ListRowViewModel) => evalFieldCondition(actionVisible, row.values),
            }),
          };
        }
        if (dispatcher === undefined) return null;
        if (!isWriteHandlerRowAction(action)) return null;
        const writeAction = action;
        const writeActionVisible = writeAction.visible;
        return {
          id: writeAction.id,
          label: effectiveTranslate(writeAction.label),
          style: writeAction.style,
          confirm:
            writeAction.confirm !== undefined ? effectiveTranslate(writeAction.confirm) : undefined,
          confirmLabel:
            writeAction.confirmLabel !== undefined
              ? effectiveTranslate(writeAction.confirmLabel)
              : undefined,
          onTrigger: async (row: ListRowViewModel) => {
            const buildPayload = writeAction.payload;
            const payload =
              buildPayload !== undefined
                ? evalRowExtractor(buildPayload, row.values)
                : { id: row.values["id"] };
            const result = await dispatcher.write(writeAction.handler, payload);
            // write() wirft nicht — Failure-Result MUSS hier zum Error
            // werden, sonst schließt der Confirm-Dialog kommentarlos und
            // der User sieht "nichts passiert" (Prod-Bug 2026-06-07).
            if (!result.isSuccess) {
              throw new WriteFailedError(
                result.error,
                dispatcherErrorText(result.error, effectiveTranslate),
              );
            }
            // Refetch — without a redirect nothing else remounts the screen,
            // so the list would otherwise keep showing stale rows.
            await rowsQuery.refetch();
          },
          isVisible:
            writeActionVisible !== undefined
              ? (row: ListRowViewModel) => evalFieldCondition(writeActionVisible, row.values)
              : undefined,
        };
      })
      .filter((a: DataTableRowAction | null): a is DataTableRowAction => a !== null);
  }, [screen.rowActions, effectiveTranslate, dispatcher, runNavigate, rowsQuery.refetch]);

  // ToolbarActions: Schema → Resolved-Form (analog rowActions).
  // navigate-kind → useNav().navigate({ screenId }), writeHandler-kind
  // → dispatcher.write(handler, payload?()). KumikoScreen kennt schon
  // useNav (aus dem normalen Routing-Stack).
  const toolbarActions = useMemo(() => {
    if (screen.toolbarActions === undefined) return undefined;
    return screen.toolbarActions
      .map((action: ToolbarAction): ToolbarActionButton | null => {
        if (action.kind === "navigate") {
          return {
            id: action.id,
            label: effectiveTranslate(action.label),
            ...(action.style !== undefined && { style: action.style }),
            onTrigger: () => nav.navigate({ screenId: action.screen }),
          };
        }
        if (action.kind === "drawer") {
          return {
            id: action.id,
            label: effectiveTranslate(action.label),
            ...(action.style !== undefined && { style: action.style }),
            onTrigger: () => openDrawer(action),
          };
        }
        // writeHandler — braucht Dispatcher. Wenn keiner mounted ist,
        // skippen wir die Action statt zu crashen (gleiche Logik wie
        // bei rowActions; einmaliger Warn-Log dort reicht).
        if (dispatcher === undefined) return null;
        return {
          id: action.id,
          label: effectiveTranslate(action.label),
          ...(action.style !== undefined && { style: action.style }),
          ...(action.confirm !== undefined && { confirm: effectiveTranslate(action.confirm) }),
          ...(action.confirmLabel !== undefined && {
            confirmLabel: effectiveTranslate(action.confirmLabel),
          }),
          onTrigger: async () => {
            const payload = action.payload ?? {};
            const result = await dispatcher.write(action.handler, payload);
            // Gleicher Surfacing-Zwang wie bei rowActions (Prod-Bug
            // 2026-06-07): ein verschlucktes Failure-Result sah wie
            // "nichts passiert" aus.
            if (!result.isSuccess) {
              throw new WriteFailedError(
                result.error,
                dispatcherErrorText(result.error, effectiveTranslate),
              );
            }
            // Same refetch as rowActions above.
            await rowsQuery.refetch();
          },
        };
      })
      .filter((a: ToolbarActionButton | null): a is ToolbarActionButton => a !== null);
  }, [screen.toolbarActions, effectiveTranslate, nav, dispatcher, rowsQuery.refetch, openDrawer]);

  if (rowsQuery.loading && rowsQuery.data === null) {
    return (
      <Banner padded variant="loading" testId="kumiko-screen-loading">
        Loading…
      </Banner>
    );
  }
  if (rowsQuery.error) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-error">
        {dispatcherErrorText(rowsQuery.error, effectiveTranslate)}
      </Banner>
    );
  }

  // RenderList's onRowClick is a 1-arg callback; KumikoScreen's
  // 2-arg shape (row, entityName) is the public surface — thread the
  // screen's entity through here so callers don't have to re-derive
  // it.
  // Row-Body-Klick: eine explizit als rowClick markierte navigate-rowAction
  // gewinnt (deklarierte Author-Absicht "Klick auf die Zeile tut X"). Ohne Flag
  // bleibt der Pfad unverändert — create-app's entityEdit-Default bzw. ein vom
  // App-Author gesetztes onRowClick.
  const rowClickAction = screen.rowActions?.find(
    (a): a is RowActionNavigate => a.kind === "navigate" && a.rowClick === true,
  );
  const wrappedOnRowClick = rowClickAction
    ? (row: ListRowViewModel) => runNavigate(rowClickAction, row)
    : onRowClick !== undefined
      ? (row: ListRowViewModel) => onRowClick(row, screen.entity)
      : undefined;

  // Searchable default: explicit author choice wins, otherwise auto-on when
  // the entity has searchable fields (dead toolbar slot otherwise — the
  // server search index has nothing to filter). Gated on
  // schema.searchAdapterMissing !== true regardless of source (explicit or
  // auto) — a search bar the server can't serve would 422 at request-time
  // (#2032); matches the boot-time check in api/server.ts (#2051).
  const searchable =
    schema.searchAdapterMissing !== true &&
    (screen.searchable ??
      Object.values(entity.fields).some((f) => "searchable" in f && f.searchable === true));

  // Pager-Props nur bei pagination="pages" zusammenstellen. Server-
  // total kommt async — bis es da ist, rendert RenderList die Tabelle
  // ohne Pager (Pager hat eine eigene total>0-Guard).
  const total = rowsQuery.data?.total;
  const pager =
    usePager && total !== undefined
      ? {
          page: urlState.page,
          limit,
          total,
          onPageChange: urlState.setPage,
        }
      : undefined;

  // Bei Infinite-Mode: rows kommen aus accumulated (über mehrere
  // useQuery-Calls gesammelt), bei pages/false aus dem aktuellen Result.
  const renderRows = useInfinite ? accumulated : (rowsQuery.data?.rows ?? []);

  return (
    <>
      <RenderList
        screen={screen}
        entity={entity}
        rows={renderRows}
        featureName={featureName}
        searchable={searchable}
        searchValue={urlState.q}
        onSearchChange={urlState.setQ}
        sort={effectiveSort}
        onSortChange={urlState.setSort}
        {...(pager !== undefined && { pager })}
        {...(rowActions !== undefined && { rowActions })}
        {...(toolbarActions !== undefined && toolbarActions.length > 0 && { toolbarActions })}
        {...(useInfinite && {
          onReachEnd: loadMore,
          loadingMore: rowsQuery.loading,
          hasMore,
        })}
        {...(onCreate !== undefined && { onCreate })}
        {...(translate !== undefined && { translate })}
        {...(wrappedOnRowClick !== undefined && { onRowClick: wrappedOnRowClick })}
        {...(filterFacets.length > 0 && {
          filterFacets,
          filterValues: urlState.filters,
          onFilterChange: urlState.setFilter,
          onFilterReset: urlState.clearFilters,
        })}
      />
      <ToolbarDrawerHost
        schema={schema}
        drawerAction={drawerAction}
        drawerScreen={drawerScreen}
        userRoles={userRoles}
        {...(translate !== undefined && { translate })}
        onClose={closeDrawer}
        onSuccess={() => {
          closeDrawer();
          void rowsQuery.refetch();
        }}
      />
    </>
  );
}

// ---- projection-list ----

// Like entityList, but the list query comes DIRECTLY from `screen.query`
// (instead of being derived from an entity) — cross-feature capable.
// search/sort/pagination reuse the same URL-state + buildListQueryPayload
// wiring as EntityListBody; which of them are actually offered is derived
// from the query handler's Zod schema at buildAppSchema time (fw#2165), not
// declared here. Pages-mode pagination only — infinite-scroll accumulation
// isn't wired for projectionList.
function ProjectionListBody({
  schema,
  screen,
  translate,
  onRowClick,
}: {
  readonly schema: FeatureSchema;
  readonly screen: ProjectionListScreenDefinition;
  readonly translate?: Translate;
  readonly onRowClick?: (row: ListRowViewModel, entityName: string) => void;
}): ReactNode {
  const { Banner, Text } = usePrimitives();
  const t = useTranslation();
  const nav = useNav();
  const dispatcher = useOptionalDispatcher();
  const effectiveTranslate = translate ?? t;
  const userRoles = useUserRoles();
  const { drawerAction, drawerScreen, openDrawer, closeDrawer } = useToolbarDrawerAction(schema);

  // searchable/sortable/paginated are derived at buildAppSchema time from the
  // query handler's Zod schema (fw#2165) — not authored on the screen.
  const searchable = screen.searchable ?? false;
  const sortable = screen.sortable ?? false;
  const paginated = screen.paginated ?? false;
  const entity = useMemo(
    () => synthesizeProjectionEntity(screen.columns, sortable),
    [screen.columns, sortable],
  );
  const listScreen = useMemo(() => synthesizeProjectionScreen(screen), [screen]);

  const urlState = useListUrlState(screen.id);
  // Gated on the derived capability, not just on whether URL-state happens to
  // carry a value — a stale/hand-crafted URL (?…q=x on a non-searchable
  // screen) must not smuggle a param the query's Zod schema doesn't accept.
  const activeSearch = searchable ? urlState.q : "";
  const activeSort = sortable ? (urlState.sort ?? screen.defaultSort ?? null) : null;
  const limit = screen.pageSize ?? 50;
  // Pages-mode only (see header comment) — an author-set pagination:
  // "infinite" on a paginated projectionList is silently a no-op today.
  const usePager = paginated && (screen.pagination ?? "pages") === "pages";

  // Facets (fw#2224) — a projectionList has no entity, so screen.facets is
  // the only field inventory; resolveProjectionFacetSpecs reshapes +
  // translates its explicit labels into the same ResolvedFacetSpec the
  // entityList adapter produces, so both feed the same
  // buildFilterFacets/buildFilterPayload.
  const facetSpecs = useMemo(
    () => resolveProjectionFacetSpecs(screen.facets, effectiveTranslate),
    [screen.facets, effectiveTranslate],
  );
  const filterPayload = useMemo(
    () =>
      buildFilterPayload(
        urlState.filters,
        (field) => facetSpecs.find((spec) => spec.field === field)?.type,
      ),
    [urlState.filters, facetSpecs],
  );

  const queryPayload = useMemo(() => {
    const payload = buildListQueryPayload({
      limit,
      search: activeSearch,
      sort: activeSort,
      usePager,
      page: urlState.page,
      useInfinite: false,
      cursor: undefined,
    });
    // Gated on screen.filter/screen.facets being declared (not just on
    // urlState/filterPayload happening to carry a value) — same rule as
    // activeSearch/activeSort above: a stale URL must not smuggle a param
    // the bound query's Zod schema doesn't accept (fw#2165 pattern).
    if (screen.filter !== undefined) {
      payload["filter"] = screen.filter;
    }
    if (screen.facets !== undefined && filterPayload.length > 0) {
      payload["filters"] = filterPayload;
    }
    return payload;
  }, [
    limit,
    activeSearch,
    activeSort,
    usePager,
    urlState.page,
    screen.filter,
    screen.facets,
    filterPayload,
  ]);

  const rowsQuery = useQuery<PagedRows>(screen.query, queryPayload, { live: true });

  const filterFacets = useMemo<DataTableFacet[]>(() => buildFilterFacets(facetSpecs), [facetSpecs]);

  const runNavigate = useCallback(
    (action: RowActionNavigate, row: ListRowViewModel) => {
      if (action.entity !== undefined) {
        // Entity-Targets (fw#2228) — siehe EntityListBody.runNavigate für die
        // Begründung, warum die Auflösung in der NavApi-Impl passiert. Anders
        // als dort: KEIN row["id"]-Fallback — projectionList-Rows kommen aus
        // einer beliebigen Query-Projection ohne garantiertes "id"-Feld
        // (gleiche Begründung wie beim screen-Target unten). Der Boot-
        // Validator erzwingt deshalb einen expliziten entityId für
        // projectionList-entity-Targets.
        const id = action.entityId !== undefined ? String(row.values[action.entityId] ?? "") : "";
        nav.navigate({ entity: action.entity, id });
      } else if (action.screen !== undefined) {
        const entityId =
          action.entityId !== undefined ? String(row.values[action.entityId] ?? "") : undefined;
        nav.navigate({
          screenId: action.screen,
          ...(entityId !== undefined && entityId !== "" && { entityId }),
        });
      }
      const params =
        action.params !== undefined ? evalRowExtractor(action.params, row.values) : undefined;
      if (params !== undefined) {
        const stringified: Record<string, string | null> = {};
        for (const [k, v] of Object.entries(params)) {
          stringified[k] =
            v === null || v === undefined ? null : Array.isArray(v) ? JSON.stringify(v) : String(v);
        }
        nav.setSearchParams(stringified);
      }
    },
    [nav],
  );

  const rowActions = useMemo((): readonly DataTableRowAction[] | undefined => {
    if (screen.rowActions === undefined) return undefined;
    const out: DataTableRowAction[] = [];
    for (const action of screen.rowActions) {
      if (action.kind === "navigate") {
        const navigateAction = action;
        const visible = action.visible;
        out.push({
          id: action.id,
          label: effectiveTranslate(action.label),
          ...(action.style !== undefined && { style: action.style }),
          onTrigger: (row: ListRowViewModel) => runNavigate(navigateAction, row),
          ...(visible !== undefined && {
            isVisible: (row: ListRowViewModel) => evalFieldCondition(visible, row.values),
          }),
        });
        continue;
      }
      // writeHandler (default-kind) — gleicher Dispatch-Pfad wie entityList:
      // Failure-Result MUSS zum Error werden (sonst schließt der Confirm-
      // Dialog kommentarlos).
      if (dispatcher === undefined) continue;
      const writeAction = action;
      const writeVisible = writeAction.visible;
      out.push({
        id: writeAction.id,
        label: effectiveTranslate(writeAction.label),
        ...(writeAction.style !== undefined && { style: writeAction.style }),
        ...(writeAction.confirm !== undefined && {
          confirm: effectiveTranslate(writeAction.confirm),
        }),
        ...(writeAction.confirmLabel !== undefined && {
          confirmLabel: effectiveTranslate(writeAction.confirmLabel),
        }),
        onTrigger: async (row: ListRowViewModel) => {
          const payload =
            writeAction.payload !== undefined
              ? evalRowExtractor(writeAction.payload, row.values)
              : { id: row.values["id"] };
          const result = await dispatcher.write(writeAction.handler, payload);
          if (!result.isSuccess) {
            throw new WriteFailedError(
              result.error,
              dispatcherErrorText(result.error, effectiveTranslate),
            );
          }
          // Same refetch as EntityListBody's rowActions above.
          await rowsQuery.refetch();
        },
        ...(writeVisible !== undefined && {
          isVisible: (row: ListRowViewModel) => evalFieldCondition(writeVisible, row.values),
        }),
      });
    }
    return out.length > 0 ? out : undefined;
  }, [screen.rowActions, effectiveTranslate, runNavigate, dispatcher, rowsQuery.refetch]);

  const toolbarActions = useMemo((): readonly ToolbarActionButton[] | undefined => {
    if (screen.toolbarActions === undefined) return undefined;
    const out: ToolbarActionButton[] = [];
    for (const action of screen.toolbarActions) {
      if (action.kind === "navigate") {
        const target = action.screen;
        out.push({
          id: action.id,
          label: effectiveTranslate(action.label),
          ...(action.style !== undefined && { style: action.style }),
          onTrigger: () => nav.navigate({ screenId: target }),
        });
        continue;
      }
      if (action.kind === "drawer") {
        out.push({
          id: action.id,
          label: effectiveTranslate(action.label),
          ...(action.style !== undefined && { style: action.style }),
          onTrigger: () => openDrawer(action),
        });
        continue;
      }
      // writeHandler — analog entityList; ohne Dispatcher skippen statt crashen.
      if (dispatcher === undefined) continue;
      out.push({
        id: action.id,
        label: effectiveTranslate(action.label),
        ...(action.style !== undefined && { style: action.style }),
        ...(action.confirm !== undefined && { confirm: effectiveTranslate(action.confirm) }),
        ...(action.confirmLabel !== undefined && {
          confirmLabel: effectiveTranslate(action.confirmLabel),
        }),
        onTrigger: async () => {
          const result = await dispatcher.write(action.handler, action.payload ?? {});
          // Gleicher Surfacing-Zwang wie bei rowActions (Prod-Bug
          // 2026-06-07): ein verschlucktes Failure-Result sah wie
          // "nichts passiert" aus.
          if (!result.isSuccess) {
            throw new WriteFailedError(
              result.error,
              dispatcherErrorText(result.error, effectiveTranslate),
            );
          }
          // Same refetch as rowActions above.
          await rowsQuery.refetch();
        },
      });
    }
    return out.length > 0 ? out : undefined;
  }, [screen.toolbarActions, effectiveTranslate, nav, dispatcher, rowsQuery.refetch, openDrawer]);

  if (rowsQuery.loading && rowsQuery.data === null) {
    return (
      <Banner padded variant="loading" testId="kumiko-screen-loading">
        Loading…
      </Banner>
    );
  }
  if (rowsQuery.error) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-error">
        {dispatcherErrorText(rowsQuery.error, effectiveTranslate)}
      </Banner>
    );
  }

  // rowsQuery.data is typed as PagedRows but the query handler is free to
  // return anything at runtime (fw#2216: a bare array silently rendered an
  // empty table instead of surfacing the mismatch); a system-boundary cast
  // is needed to inspect the actual wire shape before trusting it.
  const rawRowsData = rowsQuery.data as unknown as { readonly rows?: unknown } | null;
  if (rawRowsData !== null && !Array.isArray(rawRowsData.rows)) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-projection-list-bad-shape">
        Screen <Text variant="code">{screen.id}</Text> query{" "}
        <Text variant="code">{screen.query}</Text> did not return a PagedRows envelope; a
        projectionList query must return <Text variant="code">{"{ rows, nextCursor }"}</Text>.
      </Banner>
    );
  }

  const rowClickAction = screen.rowActions?.find(
    (a): a is RowActionNavigate => a.kind === "navigate" && a.rowClick === true,
  );
  const wrappedOnRowClick = rowClickAction
    ? (row: ListRowViewModel) => runNavigate(rowClickAction, row)
    : onRowClick !== undefined
      ? (row: ListRowViewModel) => onRowClick(row, listScreen.entity)
      : undefined;

  // Same pager-construction as EntityListBody: no Pager UI until the
  // server-provided `total` arrives (guards pagination="pages" without
  // totalCount support, see fw#2165 report on solon's leaseOverviewHandler).
  const total = rowsQuery.data?.total;
  const pager =
    usePager && total !== undefined
      ? { page: urlState.page, limit, total, onPageChange: urlState.setPage }
      : undefined;

  return (
    <>
      <RenderList
        screen={listScreen}
        entity={entity}
        rows={rowsQuery.data?.rows ?? []}
        featureName={schema.featureName}
        searchable={searchable}
        searchValue={urlState.q}
        onSearchChange={urlState.setQ}
        sort={activeSort}
        onSortChange={urlState.setSort}
        {...(pager !== undefined && { pager })}
        {...(rowActions !== undefined && { rowActions })}
        {...(toolbarActions !== undefined && { toolbarActions })}
        {...(translate !== undefined && { translate })}
        {...(wrappedOnRowClick !== undefined && { onRowClick: wrappedOnRowClick })}
        {...(filterFacets.length > 0 && {
          filterFacets,
          filterValues: urlState.filters,
          onFilterChange: urlState.setFilter,
          onFilterReset: urlState.clearFilters,
        })}
      />
      <ToolbarDrawerHost
        schema={schema}
        drawerAction={drawerAction}
        drawerScreen={drawerScreen}
        userRoles={userRoles}
        {...(translate !== undefined && { translate })}
        onClose={closeDrawer}
        onSuccess={() => {
          closeDrawer();
          void rowsQuery.refetch();
        }}
      />
    </>
  );
}

// Projection-Detail-Body — read-only single-row inspector über eine explizite
// Query statt einer Entity (siehe projection-detail-shim.ts für die Schulden-
// Doku). Fetcht selbst über `screen.query` + `idParam` (analog zu
// EntityEditUpdateBody, das die Query-QN aus der Entity-Convention ableitet —
// hier ist die QN Author-explizit, wie bei ProjectionListBody). Rendert über
// RenderEdit MIT customSubmit-No-Op statt writeCommand: hasEditableSection()
// blendet den Save-Button aus (jedes Feld ist readOnly), und selbst ein
// natives Form-Submit (Enter-Keypress) würde ohne customSubmit gegen
// controller.submit() ohne submit-config throwen — der No-Op macht diesen
// Pfad harmlos statt ihn dem Zufall zu überlassen.
function ProjectionDetailBody({
  schema,
  screen,
  translate,
  entityId,
}: {
  readonly schema: FeatureSchema;
  // detailFor sits on the ScreenDefinition intersection, not on the
  // projectionDetail variant itself (screen.ts:832) — widen the prop type
  // to keep reading it here instead of re-deriving it from schema.screens.
  readonly screen: ProjectionDetailScreenDefinition & { readonly detailFor?: string };
  readonly translate?: Translate;
  readonly entityId?: string;
}): ReactNode {
  const { Banner, Text } = usePrimitives();
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const nav = useNav();
  const idParam = screen.idParam ?? "id";
  const entity = useMemo(() => synthesizeProjectionDetailEntity(screen.layout), [screen.layout]);
  const detailScreen = useMemo(() => synthesizeProjectionDetailScreen(screen), [screen]);
  const detailQuery = useQuery<Readonly<Record<string, unknown>>>(
    screen.query,
    entityId !== undefined ? { [idParam]: entityId } : {},
  );

  // Default edit action (fw#2166): resolved cross-feature over ALL mounted
  // features, not just this feature's own schema — detailFor itself is
  // resolved cross-feature by the boot-validator (detail-screens.ts), and
  // the motivating case is a projectionDetail whose query belongs to one
  // feature while the entity's entityEdit screen lives in another. Unlike
  // useNavigateToCreateFor this must NOT filter on allowCreate/singleton —
  // those gate create-targets, we're resolving an update-target by a
  // known id.
  const appFeatures = useAppFeatures();
  const userRoles = useUserRoles();
  const dispatcher = useOptionalDispatcher();
  const editScreen = useMemo(() => {
    const detailFor = screen.detailFor;
    if (detailFor === undefined) return undefined;
    for (const feature of appFeatures) {
      // Access-check is part of the find predicate, not a filter applied
      // after the first match — two entityEdit screens for the same entity
      // where the first is role-gated must not hide an accessible second one.
      const match = feature.screens.find(
        (s): s is EntityEditScreenDefinition =>
          s.type === "entityEdit" &&
          s.entity === detailFor &&
          screenAccessAllows(s.access, userRoles),
      );
      if (match !== undefined) return match;
    }
    return undefined;
  }, [appFeatures, screen.detailFor, userRoles]);
  const defaultEditAction = useMemo((): RenderEditAction | undefined => {
    if (editScreen === undefined) return undefined;
    // editScreen.id is registry-qualified ("feature:screen:contact-edit");
    // nav.navigate expects the short form (see useNavigateToCreateFor above).
    const targetScreenId = lastSegment(editScreen.id);
    return {
      id: "edit",
      label: effectiveTranslate("kumiko.actions.edit"),
      onPress: () =>
        nav.navigate({ screenId: targetScreenId, ...(entityId !== undefined && { entityId }) }),
    };
  }, [editScreen, effectiveTranslate, nav, entityId]);

  const headerActions = useMemo((): readonly RenderEditAction[] | undefined => {
    const record = detailQuery.data ?? {};
    const declaredHasEdit = screen.actions?.some((a) => a.id === "edit") === true;
    const out: RenderEditAction[] = [];
    if (defaultEditAction !== undefined && !declaredHasEdit) {
      out.push(defaultEditAction);
    }
    for (const action of screen.actions ?? []) {
      if (action.visible !== undefined && !evalFieldCondition(action.visible, record)) {
        continue;
      }
      if (action.kind === "navigate") {
        const runParams = (): void => {
          const params =
            action.params !== undefined ? evalRowExtractor(action.params, record) : undefined;
          if (params !== undefined) {
            const stringified: Record<string, string | null> = {};
            for (const [k, v] of Object.entries(params)) {
              stringified[k] =
                v === null || v === undefined
                  ? null
                  : Array.isArray(v)
                    ? JSON.stringify(v)
                    : String(v);
            }
            nav.setSearchParams(stringified);
          }
        };
        if (action.entity !== undefined) {
          // Entity-Targets (fw#2228) — Auflösung passiert in der NavApi-Impl
          // (siehe EntityListBody.runNavigate), nicht hier. KEIN record["id"]-
          // Fallback: record kommt aus einer beliebigen Detail-Query ohne
          // garantiertes "id"-Feld, der Boot-Validator erzwingt deshalb einen
          // expliziten entityId für projectionDetail-entity-Targets.
          const targetEntity = action.entity;
          const id = action.entityId !== undefined ? String(record[action.entityId] ?? "") : "";
          out.push({
            id: action.id,
            label: effectiveTranslate(action.label),
            ...(action.style !== undefined && { style: action.style }),
            onPress: () => {
              nav.navigate({ entity: targetEntity, id });
              runParams();
            },
          });
        } else if (action.screen !== undefined) {
          // Default entityId for an entityEdit target of the SAME entity
          // (screen.detailFor plays entity's role here, like screen.entity
          // does for entityList's runNavigate) — without this fallback the
          // target opens an empty create-form instead of the shown record,
          // silently. Searched cross-feature, consistent with editScreen above.
          const explicit =
            action.entityId !== undefined ? String(record[action.entityId] ?? "") : undefined;
          const targetIsEntityEditSameEntity =
            screen.detailFor !== undefined &&
            appFeatures.some((feature) =>
              feature.screens.some(
                (s) =>
                  s.type === "entityEdit" &&
                  s.entity === screen.detailFor &&
                  lastSegment(s.id) === action.screen,
              ),
            );
          const fallback = targetIsEntityEditSameEntity ? String(record["id"] ?? "") : undefined;
          const navEntityId = explicit ?? fallback;
          const targetScreen = action.screen;
          out.push({
            id: action.id,
            label: effectiveTranslate(action.label),
            ...(action.style !== undefined && { style: action.style }),
            onPress: () => {
              nav.navigate({
                screenId: targetScreen,
                ...(navEntityId !== undefined && navEntityId !== "" && { entityId: navEntityId }),
              });
              runParams();
            },
          });
        }
        continue;
      }
      // writeHandler — same dispatch/refetch/failure-surfacing pattern as
      // ProjectionListBody's rowActions/toolbarActions above.
      if (dispatcher === undefined) continue;
      const writeAction = action;
      out.push({
        id: writeAction.id,
        label: effectiveTranslate(writeAction.label),
        ...(writeAction.style !== undefined && { style: writeAction.style }),
        ...(writeAction.confirm !== undefined && {
          confirm: effectiveTranslate(writeAction.confirm),
        }),
        ...(writeAction.confirmLabel !== undefined && {
          confirmLabel: effectiveTranslate(writeAction.confirmLabel),
        }),
        onPress: async () => {
          const payload =
            writeAction.payload !== undefined
              ? evalRowExtractor(writeAction.payload, record)
              : { id: record["id"] };
          const result = await dispatcher.write(writeAction.handler, payload);
          if (!result.isSuccess) {
            throw new WriteFailedError(
              result.error,
              dispatcherErrorText(result.error, effectiveTranslate),
            );
          }
          await detailQuery.refetch();
        },
      });
    }
    return out.length > 0 ? out : undefined;
  }, [
    screen.actions,
    screen.detailFor,
    appFeatures,
    defaultEditAction,
    effectiveTranslate,
    nav,
    dispatcher,
    detailQuery.data,
    detailQuery.refetch,
  ]);

  if (entityId === undefined) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-projection-detail-missing-id">
        Screen <Text variant="code">{screen.id}</Text> (projectionDetail) needs a row id in the path
        — open it from a row action.
      </Banner>
    );
  }
  if (detailQuery.loading && detailQuery.data === null) {
    return (
      <Banner padded variant="loading" testId="kumiko-screen-loading">
        Loading…
      </Banner>
    );
  }
  if (detailQuery.error) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-error">
        {dispatcherErrorText(detailQuery.error, effectiveTranslate)}
      </Banner>
    );
  }
  const record = detailQuery.data;
  if (!record) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-record-missing">
        Record <Text variant="code">{entityId}</Text> not found.
      </Banner>
    );
  }
  return (
    <RenderEdit
      screen={detailScreen}
      entity={entity}
      featureName={schema.featureName}
      initial={record as FormValues}
      entityId={entityId}
      customSubmit={async () => ({ isSuccess: true, validationBlocked: false, data: undefined })}
      {...(headerActions !== undefined && { actions: headerActions })}
      {...(translate !== undefined && { translate })}
      valueDisplay={screen.valueDisplay ?? "text"}
    />
  );
}
// ---- actionForm (Tier 2.7d) ----

// Action-Form-Body — non-CRUD Write-Handler-driven Form. Re-uses
// RenderEdit über synthetisierte EntityDefinition + EntityEditScreen-
// Definition (siehe action-form-shim.ts für die Schulden-Doku). Die
// Form-Mechanik (useForm, RenderEdit, DefaultInput, Banner, Submit-
// Button) ist identisch zu entityEdit, nur der Submit-Pfad wechselt
// vom CRUD-verb auf den Author-deklarierten handler-QN +
// payloadMode="values" (alle Form-Werte schicken statt nur Changes).
function ActionFormBody({
  schema,
  screen,
  translate,
  onSuccess,
  onCancelOverride,
}: {
  readonly schema: FeatureSchema;
  readonly screen: ActionFormScreenDefinition;
  readonly translate?: Translate;
  /** Drawer-hosted usage (toolbarAction kind:"drawer", fw#2225): called
   *  instead of the redirect-based navigation on successful submit, so the
   *  host closes the drawer + refetches its list regardless of whether
   *  `screen.redirect` is set — a full-page redirect would navigate away
   *  from the list the drawer sits on top of. */
  readonly onSuccess?: () => void;
  /** Drawer-hosted usage: replaces the cancelTarget/redirect-based Cancel
   *  handler so Cancel closes the drawer instead of navigating. */
  readonly onCancelOverride?: () => void;
}): ReactNode {
  const nav = useNav();
  const synthEntity = useMemo(() => synthesizeActionFormEntity(screen.fields), [screen.fields]);
  const synthScreen = useMemo(() => synthesizeActionFormScreen(screen), [screen]);
  const initial = useMemo(
    () =>
      mergeSearchParamsIntoInitial(
        screen.fields,
        nav.searchParams,
        layoutFieldNames(synthScreen),
      ) as FormValues,
    [screen.fields, nav.searchParams, synthScreen],
  );
  const handleSubmitted = useCallback(
    (result: SubmitResult<unknown>) => {
      if (!result.isSuccess) return;
      if (onSuccess !== undefined) {
        onSuccess();
        return;
      }
      // Redirect ist optional. Bei isSuccess + redirect → nav.navigate.
      // Author entscheidet bewusst ob "stay on form" (default) oder
      // "back to list" (typisch bei Create-style Aktionen).
      if (screen.redirect !== undefined) {
        nav.navigate({ screenId: lastSegment(screen.redirect) });
      }
    },
    [nav, screen.redirect, onSuccess],
  );
  // Cancel ist nur sinnvoll wenn ein Navigations-Ziel existiert —
  // sonst hätte der Button nirgendwo hin zu navigieren. cancelTarget
  // gewinnt über redirect; `false` schaltet den Button explizit ab
  // (Single-Action-Screens, wo Cancel nur Submit-ohne-Senden wäre).
  const handleCancel = useMemo<(() => void) | undefined>(() => {
    if (onCancelOverride !== undefined) return onCancelOverride;
    const target = screen.cancelTarget ?? screen.redirect;
    if (target === undefined || target === false) return undefined;
    return () => nav.navigate({ screenId: lastSegment(target) });
  }, [nav, screen.redirect, screen.cancelTarget, onCancelOverride]);
  return (
    <RenderEdit
      screen={synthScreen}
      entity={synthEntity}
      featureName={schema.featureName}
      initial={initial}
      // Extension-Sections im actionForm sehen die initialen Form-Values
      // (inkl. searchParams-Prefill, z.B. ?incidentId=…) als initialValues
      // — anders als im entityEdit gibt es hier keinen record, aus dem
      // sie Kontext ziehen könnten.
      extensionInitialValues={initial}
      writeCommand={screen.handler}
      payloadMode="values"
      onSubmit={handleSubmitted}
      {...(handleCancel !== undefined && { onCancel: handleCancel })}
      {...(screen.submitLabel !== undefined && { submitLabel: screen.submitLabel })}
      {...(translate !== undefined && { translate })}
    />
  );
}

// ---- config-edit ----
//
// Settings-Form gegen das bundled config-Feature. Liest beim Mount
// `config:query:values` (returned ALLE Keys die der User lesen darf
// als `{ [qualifiedKey]: { value, scope } }`); schreibt beim Save
// pro geändertem Feld einen `config:write:set` Call. Singleton-pro-
// Tenant kommt by-design vom config-feature (key+tenantId Unique-
// Constraint) — kein Bridge-Hack, keine extra Aggregate.
//
// Parallel-Aufbau zu ActionFormBody: synthesisierte Entity + EntityEdit-
// Screen damit RenderEdit reused werden kann; Layout/Field-Rendering/
// Banner/Submit-Button-State sind identisch zu entityEdit. Der einzige
// Pfad-Unterschied ist customSubmit das mehrere config:write:set-Calls
// orchestriert.
//
// Response enthält seit config-seeding auch `source` (z.B. "system-row")
// für das ConfigSourceBadge. Type wird lokal gehalten da er nur hier
// relevant ist — kein eigener Export nötig.
type ConfigValueResponse = Readonly<
  Record<string, { value: string | number | boolean | undefined; scope: string; source: string }>
>;

// A money-typed config-edit field renders through RenderField's entityEdit
// `{amount, currency}` payload shape (render-field.tsx, #1923), but
// `ConfigKeyType` (write-helpers.ts validateType) only ever knows
// number/boolean/text/select — a config value is always a bare scalar.
// Unwrap back to the amount before it hits config:write:set.
function unwrapMoneyValue(value: unknown): unknown {
  if (typeof value === "object" && value !== null && "amount" in value) {
    const amount = (value as { amount?: unknown }).amount;
    if (typeof amount === "number") return amount;
  }
  return value;
}

function ConfigEditBody({
  schema,
  screen,
  translate,
}: {
  readonly schema: FeatureSchema;
  readonly screen: ConfigEditScreenDefinition;
  readonly translate?: Translate;
}): ReactNode {
  const { Banner, ConfigCascadeView } = usePrimitives();
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const dispatcher = useDispatcher();

  // Detail-Load: config:query:values returnt ALLE Keys des Tenants.
  // Wir mappen via screen.configKeys von short → qualified-name auf
  // unsere Form-Field-Werte.
  const valuesQuery = useQuery<ConfigValueResponse>("config:query:values", {});

  const cascadeQuery = useQuery<Record<string, ConfigCascade>>("config:query:cascade", {});

  const synthEntity = useMemo(() => synthesizeConfigEditEntity(screen.fields), [screen.fields]);
  const synthScreen = useMemo(() => synthesizeConfigEditScreen(screen), [screen]);

  // Initial-Values: pro Field-Name den Wert aus `values[qualifiedKey]`
  // abholen. Fehlt der Key auf dem Server (= noch nie gesetzt), nutzen
  // wir den Field-Default (createTextField/createNumberField/...).
  // String-coerce nur für Text-Fields; andere Types sollten in der
  // Response bereits Native-Type sein.
  const initial = useMemo<FormValues | null>(() => {
    if (valuesQuery.data === null) return null;
    const out: Record<string, unknown> = {};
    const defaults = buildInitialValues(screen.fields) as Record<string, unknown>; // @cast-boundary render-helper
    for (const [shortName, fieldDef] of Object.entries(screen.fields)) {
      const qualified = screen.configKeys[shortName];
      if (qualified === undefined) {
        // Author hat ein Field deklariert ohne Mapping — nimm Default.
        // Boot-Validator pinnt das, sollte nie zur Runtime greifen.
        out[shortName] = defaults[shortName];
        continue;
      }
      const stored = valuesQuery.data[qualified]?.value;
      if (stored === undefined) {
        out[shortName] = defaults[shortName];
        continue;
      }
      const ftype = (fieldDef as { type?: string }).type;
      // Field-Type-Coercion: config-Werte sind string|number|boolean,
      // aber der Form-State erwartet das passende Field-Native-Type.
      if (ftype === "number" || ftype === "money") {
        out[shortName] = typeof stored === "number" ? stored : Number(stored);
      } else if (ftype === "boolean") {
        out[shortName] = typeof stored === "boolean" ? stored : stored === "true";
      } else {
        out[shortName] = typeof stored === "string" ? stored : String(stored);
      }
    }
    return out as FormValues;
  }, [valuesQuery.data, screen.fields, screen.configKeys]);

  // Cascade-Lookup: qualifiedKey → ConfigCascade für die
  // Cascade-Anzeige unter jedem Feld. Defensive `levels`-Shape-Check
  // damit fremde Query-Mocks (z.B. configEdit-Unit-Tests die nur
  // `config:query:values` mocken) nicht durch das Cascade-Rendering
  // crashen.
  const cascades = useMemo<Record<string, ConfigCascade>>(() => {
    if (!cascadeQuery.data) return {};
    const out: Record<string, ConfigCascade> = {};
    for (const [shortName, qualified] of Object.entries(screen.configKeys)) {
      const cascade = cascadeQuery.data[qualified];
      if (cascade && Array.isArray(cascade.levels)) out[shortName] = cascade;
    }
    return out;
  }, [cascadeQuery.data, screen.configKeys]);

  // Multi-Write Submit: ein einzelner /api/batch Call mit N
  // config:write:set Commands. Server-side ist batch atomic
  // (transaktional: alle Writes in einer DB-TX, all-or-nothing) und
  // browser-side ist es genau eine HTTP-Roundtrip — kein Race zwischen
  // mehreren in-flight fetches die der Browser bei page.reload mid-
  // submit aborten könnte. Promise.all von N separaten dispatcher.write-
  // Calls war fragil: server bekommt + commited alle N, aber das
  // Browser-Connection-Pool gibt sporadisch "Failed to fetch" für
  // einzelne Responses zurück, customSubmit returnt failure obwohl der
  // Write durch ist, das Form bleibt dirty.
  const customSubmit = useCallback(
    async (snapshot: FormSnapshot<FormValues>): Promise<SubmitResult<unknown>> => {
      const commands: Command[] = [];
      for (const [shortName, value] of Object.entries(snapshot.changes)) {
        const qualified = screen.configKeys[shortName];
        if (qualified === undefined) continue;
        const ftype = (screen.fields[shortName] as { type?: string } | undefined)?.type;
        commands.push({
          type: "config:write:set",
          payload: {
            key: qualified,
            value: ftype === "money" ? unwrapMoneyValue(value) : value,
            scope: screen.scope,
          },
        });
      }
      if (commands.length === 0) {
        return { validationBlocked: false, isSuccess: true, data: undefined };
      }
      const result = await dispatcher.batch(commands);
      if (!result.isSuccess) {
        return { validationBlocked: false, isSuccess: false, error: result.error };
      }
      // Cascade-Disclosure + Maskenwerte nach dem Write nachziehen, sonst
      // bleibt die Anzeige stale bis Reload — gleiche refetch-Calls wie onReset.
      // allSettled: der Write ist schon committed, ein gescheitertes Refetch
      // (stale Anzeige) darf das Erfolgsergebnis nicht in einen Fehler kippen.
      await Promise.allSettled([valuesQuery.refetch?.(), cascadeQuery.refetch?.()]);
      return { validationBlocked: false, isSuccess: true, data: undefined };
    },
    [
      dispatcher,
      screen.configKeys,
      screen.fields,
      screen.scope,
      valuesQuery.refetch,
      cascadeQuery.refetch,
    ],
  );

  // Cascade-Disclosure (#429): Trigger sitzt in der Label-Row, das Panel
  // unter dem Input — zwei getrennte Render-Slots teilen sich den
  // expanded-State, der daher hier (pro Feld) statt in der Komponente lebt.
  const [expandedFields, setExpandedFields] = useState<ReadonlySet<string>>(new Set());
  const toggleExpanded = useCallback((fieldName: string) => {
    setExpandedFields((prev) => {
      const next = new Set(prev);
      if (next.has(fieldName)) next.delete(fieldName);
      else next.add(fieldName);
      return next;
    });
  }, []);

  if (valuesQuery.loading && valuesQuery.data === null) {
    return (
      <Banner padded variant="loading" testId="kumiko-screen-loading">
        Loading…
      </Banner>
    );
  }
  if (valuesQuery.error) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-error">
        {dispatcherErrorText(valuesQuery.error, effectiveTranslate)}
      </Banner>
    );
  }
  if (initial === null) {
    return (
      <Banner padded variant="loading" testId="kumiko-screen-loading">
        Loading…
      </Banner>
    );
  }
  return (
    <RenderEdit
      screen={synthScreen}
      entity={synthEntity}
      featureName={schema.featureName}
      initial={initial}
      customSubmit={customSubmit}
      {...(screen.submitLabel !== undefined && { submitLabel: screen.submitLabel })}
      {...(translate !== undefined && { translate })}
      labelAppendix={(fieldName: string) => {
        const cascade = cascades[fieldName];
        if (cascade === undefined) return undefined;
        return (
          <ConfigCascadeView
            slot="trigger"
            cascade={cascade}
            screenScope={screen.scope}
            expanded={expandedFields.has(fieldName)}
            onToggle={() => toggleExpanded(fieldName)}
          />
        );
      }}
      fieldAppendix={(fieldName: string) => {
        const cascade = cascades[fieldName];
        // Panel nur rendern wenn aufgeklappt — sonst kein leerer Abstand
        // unter dem Input.
        if (cascade === undefined || !expandedFields.has(fieldName)) return undefined;
        return (
          <ConfigCascadeView
            slot="panel"
            cascade={cascade}
            screenScope={screen.scope}
            expanded
            qualifiedKey={screen.configKeys[fieldName]}
            onReset={async (key, scope) => {
              await dispatcher.write("config:write:reset", { key, scope });
              await Promise.allSettled([valuesQuery.refetch?.(), cascadeQuery.refetch?.()]);
            }}
          />
        );
      }}
    />
  );
}

// Re-export the ScreenDefinition type so callers don't reach into
// framework/ui-types for a prop-type they need to narrow on.
export type { ScreenDefinition };
