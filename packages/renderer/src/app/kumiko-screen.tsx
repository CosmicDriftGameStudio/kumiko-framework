import type { ConfigCascade } from "@cosmicdrift/kumiko-framework/engine";
import type {
  ActionFormScreenDefinition,
  ConfigEditScreenDefinition,
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
  RowAction,
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
import { fieldLabelKey } from "@cosmicdrift/kumiko-headless";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RenderEdit } from "../components/render-edit";
import { RenderList, type ToolbarActionButton } from "../components/render-list";
import { useDispatcher, useOptionalDispatcher } from "../context/dispatcher-context";
import { useListUrlState } from "../hooks/use-list-url-state";
import { useQuery } from "../hooks/use-query";
import { useTranslation } from "../i18n";
import { type DataTableFacet, type DataTableRowAction, usePrimitives } from "../primitives";
import { synthesizeActionFormEntity, synthesizeActionFormScreen } from "./action-form-shim";
import { synthesizeConfigEditEntity, synthesizeConfigEditScreen } from "./config-edit-shim";
import { useCustomScreenComponent } from "./custom-screens";
import type { FeatureSchema } from "./feature-schema";
import { useNav } from "./nav";
import { lastSegment } from "./qn";
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
  // Optional entity-id. Only meaningful for entityEdit screens — when
  // set, the edit screen loads the existing record via the detail
  // query and submits an update command (`write:<entity>:update`)
  // instead of a create. For entityList/custom screens it's ignored.
  readonly entityId?: string;
  // Fires when the user clicks a row on an entityList screen. The
  // second argument is the screen's entity name, threaded through so
  // the caller's handler can navigate to `<edit screen for this
  // entity>/{row.id}` without re-deriving it. Default wiring in
  // createKumikoApp does exactly that; override to open a drawer,
  // inline-expand, etc.
  readonly onRowClick?: (row: ListRowViewModel, entityName: string) => void;
};

// Build the qualified name the registry would stamp on screen ingest:
// <feature>:screen:<short-id>. Matches the rule in
// packages/framework/src/engine/qualified-name.ts so client lookups
// line up with server-side registry state.
export function qualifyScreenId(featureName: string, screenId: string): string {
  return `${featureName}:screen:${screenId}`;
}

/** Symmetrisch zu qualifyScreenId für Nav-QNs. NavDefinition-IDs in der
 *  Registry haben die Form `<feature>:nav:<short-id>`; Code der QNs
 *  baut (z.B. WorkspaceShell-Resolver) sollte das hier durchreichen statt
 *  String-Concat damit ein zukünftiger QN-Schema-Wechsel an einer Stelle
 *  greift. */
export function qualifyNavId(featureName: string, navId: string): string {
  return `${featureName}:nav:${navId}`;
}

export function KumikoScreen({
  schema,
  qn,
  translate,
  entityId,
  onRowClick,
}: KumikoScreenProps): ReactNode {
  const { Banner, Text } = usePrimitives();
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

  switch (screen.type) {
    case "entityEdit":
      return (
        <EntityEditScreen
          schema={schema}
          screen={screen}
          translate={translate}
          {...(entityId !== undefined && { entityId })}
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
    case "actionForm":
      return <ActionFormBody schema={schema} screen={screen} translate={translate} />;
    case "configEdit":
      return <ConfigEditBody schema={schema} screen={screen} translate={translate} />;
    case "custom":
      return <CustomScreenBody screenId={screen.id} />;
  }
}

// Lookup-Body für custom-screens: schaut die Component aus dem
// CustomScreens-Context (gefüttert von clientFeatures.components in
// createKumikoApp). Wenn weder Provider gemounted noch screenId
// registriert ist, fällt es auf einen Banner zurück — Apps die das
// sehen wissen sofort: "Component fehlt im clientFeatures.components".
function CustomScreenBody({ screenId }: { readonly screenId: string }): ReactNode {
  const { Banner, Text } = usePrimitives();
  const Component = useCustomScreenComponent(screenId);
  if (Component === undefined) {
    return (
      <Banner padded variant="info" testId="kumiko-screen-custom-placeholder">
        Custom screen <Text variant="code">{screenId}</Text> hat keine Component im{" "}
        <Text variant="code">clientFeatures.components</Text>.
      </Banner>
    );
  }
  return <Component />;
}

// ---- entity-edit ----

// Derives `<feature>:write:<entity>:<verb>` from the screen's entity
// and the schema's feature name. Matches the qualification rule in
// packages/framework/src/engine/qualified-name.ts so the server-side
// handler resolves without extra wiring.
function entityWriteCommand(
  featureName: string,
  entity: string,
  verb: "create" | "update" | "delete",
): string {
  return `${featureName}:write:${entity}:${verb}`;
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
    // Lifecycle-Write) — der zählt nicht als „+ Neu"-Ziel.
    const edit = schema.screens.find(
      (s: ScreenDefinition) =>
        s.type === "entityEdit" && s.entity === entityName && s.allowCreate !== false,
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
function buildInitialValues(
  fields: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(fields)) {
    const shape = def as { type?: string; default?: unknown };
    if (shape.default !== undefined) {
      out[name] = shape.default;
      continue;
    }
    out[name] =
      shape.type === "boolean" ? false : shape.type === "number" || shape.type === "money" ? 0 : "";
  }
  return out;
}

function EntityEditScreen({
  schema,
  screen,
  translate,
  entityId,
}: {
  readonly schema: FeatureSchema;
  readonly screen: EntityEditScreenDefinition;
  readonly translate?: Translate;
  readonly entityId?: string;
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
      />
    );
  }
  if (screen.allowCreate === false) {
    // Update-only Screen ohne entityId (Direkt-URL / verirrte Navigation):
    // ein Create-Form würde gegen den nicht registrierten
    // `<entity>:create`-Handler submitten — Fehler statt Falle.
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
    />
  );
}

function EntityEditCreateBody({
  schema,
  screen,
  entity,
  translate,
}: {
  readonly schema: FeatureSchema;
  readonly screen: EntityEditScreenDefinition;
  readonly entity: EntityDefinition;
  readonly translate?: Translate;
}): ReactNode {
  const initial = useMemo(() => buildInitialValues(entity.fields) as FormValues, [entity.fields]);
  const writeCommand = entityWriteCommand(schema.featureName, screen.entity, "create");
  const navigateToList = useNavigateToListAfter(schema, screen.entity);
  const handleSubmitted = useCallback(
    (result: SubmitResult<unknown>) => {
      if (result.isSuccess) navigateToList();
    },
    [navigateToList],
  );
  return (
    <RenderEdit
      screen={screen}
      entity={entity}
      featureName={schema.featureName}
      initial={initial}
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
}: {
  readonly schema: FeatureSchema;
  readonly screen: EntityEditScreenDefinition;
  readonly entity: EntityDefinition;
  readonly entityId: string;
  readonly translate?: Translate;
}): ReactNode {
  const { Banner, Text } = usePrimitives();
  const detailQn = `${schema.featureName}:query:${screen.entity}:detail`;
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
        {detailQuery.error.i18nKey}
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
}: {
  readonly schema: FeatureSchema;
  readonly screen: EntityEditScreenDefinition;
  readonly entity: EntityDefinition;
  readonly entityId: string;
  readonly record: Readonly<Record<string, unknown>>;
  readonly onReload: () => Promise<void> | void;
  readonly translate?: Translate;
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
    for (const name of Object.keys(entity.fields)) {
      out[name] = record[name] ?? buildInitialValues({ [name]: entity.fields[name] })[name];
    }
    return out as FormValues;
  }, [entity.fields, record]);

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

  const dispatcher = useDispatcher();
  const navigateToList = useNavigateToListAfter(schema, screen.entity);
  const handleSubmitted = useCallback(
    (result: SubmitResult<unknown>) => {
      if (result.isSuccess) navigateToList();
    },
    [navigateToList],
  );
  const handleDelete = useCallback(async () => {
    const res = await dispatcher.write(deleteCommand, { id: entityId });
    if (res.isSuccess) navigateToList();
  }, [dispatcher, deleteCommand, entityId, navigateToList]);

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
    />
  );
}

// ---- entity-list ----

function entityQueryCommand(featureName: string, entity: string, verb: "list"): string {
  return `${featureName}:query:${entity}:${verb}`;
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
  // Boolean-Felder: "true"/"false"-Strings zu echten Booleans coercen
  // (DB-Spalte ist boolean). Alles als op:"in" (Multi-Select-Semantik).
  const filterPayload = useMemo(() => {
    const out: { field: string; op: "in"; value: unknown }[] = [];
    for (const [field, values] of Object.entries(urlState.filters)) {
      if (values.length === 0) continue;
      // entity.fields ist am Renderer-Layer schwach getypt (vom Schema
      // deserialisiert) — Boundary-Cast wie buildInitialValues.
      const def = entity.fields[field] as { type?: string } | undefined;
      if (def === undefined) continue;
      const value = def.type === "boolean" ? values.map((v) => v === "true") : values;
      out.push({ field, op: "in", value });
    }
    return out;
  }, [urlState.filters, entity.fields]);

  // Payload für den Server-Query-Handler (LIST_PAYLOAD_SCHEMA):
  // search/sort/sortDirection/limit + offset/totalCount für Pager-Mode
  // ODER cursor für Infinite-Scroll.
  const queryPayload = useMemo(() => {
    const payload: Record<string, unknown> = { limit };
    if (urlState.q !== "") payload["search"] = urlState.q;
    if (effectiveSort !== null) {
      payload["sort"] = effectiveSort.field;
      payload["sortDirection"] = effectiveSort.dir;
    }
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
    if (usePager) {
      // page=1 → offset=0, page=2 → offset=limit, etc. Server
      // clampt selbst wenn offset >= total.
      const offset = (urlState.page - 1) * limit;
      if (offset > 0) payload["offset"] = offset;
      // totalCount: extra COUNT(*) damit der Pager "Page X of Y"
      // rendern kann. Bei pagination=false oder "infinite" sparen wir
      // den Roundtrip.
      payload["totalCount"] = true;
    } else if (useInfinite && cursor !== undefined) {
      payload["cursor"] = cursor;
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
  const filterFacets = useMemo<DataTableFacet[]>(() => {
    const out: DataTableFacet[] = [];
    for (const [field, rawDef] of Object.entries(entity.fields)) {
      // entity.fields ist am Renderer-Layer schwach getypt (Record<string,
      // unknown>, vom Schema deserialisiert) — Boundary-Cast wie buildInitialValues.
      const def = rawDef as {
        type?: string;
        filterable?: boolean;
        options?: readonly string[];
      };
      if (def.filterable !== true) continue;
      const label = effectiveTranslate(fieldLabelKey(featureName, screen.entity, field));
      if (def.type === "select" && Array.isArray(def.options)) {
        out.push({
          field,
          label,
          options: def.options.map((value) => ({
            value,
            label: effectiveTranslate(
              `${featureName}:entity:${screen.entity}:field:${field}:option:${value}`,
            ),
          })),
        });
      } else if (def.type === "boolean") {
        out.push({
          field,
          label,
          // ponytail: Yes/No literal — boolean-Facet-Labels i18n'en wenn eine App es braucht
          options: [
            { value: "true", label: "Yes" },
            { value: "false", label: "No" },
          ],
        });
      }
    }
    return out;
  }, [entity.fields, featureName, screen.entity, effectiveTranslate]);

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
  const rowActions = useMemo(() => {
    if (screen.rowActions === undefined) return undefined;
    return screen.rowActions
      .map((action: RowAction): DataTableRowAction | null => {
        // navigate-Variante braucht keinen Dispatcher; nav ist
        // immer da (Provider von createKumikoApp).
        if (action.kind === "navigate") {
          // Default entityId für entityEdit-Targets: row["id"] wenn
          // kein expliziter entityId-Feldname gesetzt ist. Nur für Targets
          // DERSELBEN Entity — ein Cross-Entity-Edit-Screen bekäme sonst die
          // falsche row.id injiziert, und "Duplicate → Create"-Patterns
          // würden in den Update-Mode gezwungen. Cross-Entity-Navigation
          // setzt action.entityId explizit.
          const targetIsEntityEdit = schema.screens.some(
            (s) =>
              s.type === "entityEdit" &&
              s.entity === screen.entity &&
              lastSegment(s.id) === action.screen,
          );
          const actionVisible = action.visible;
          return {
            id: action.id,
            label: effectiveTranslate(action.label),
            ...(action.style !== undefined && { style: action.style }),
            onTrigger: (row: ListRowViewModel) => {
              const explicit =
                action.entityId !== undefined
                  ? String(row.values[action.entityId] ?? "")
                  : undefined;
              const fallback = targetIsEntityEdit ? String(row.values["id"] ?? "") : undefined;
              const entityId = explicit ?? fallback;
              nav.navigate({
                screenId: action.screen,
                ...(entityId !== undefined && entityId !== "" && { entityId }),
              });
              const params =
                action.params !== undefined
                  ? evalRowExtractor(action.params, row.values)
                  : undefined;
              if (params !== undefined) {
                // setSearchParams nimmt string|null. Komplexe Werte
                // (number/boolean) wandeln wir zu String — der Reader
                // (use-list-url-state / actionForm-init) kennt nur
                // Strings via URL.
                const stringified: Record<string, string | null> = {};
                for (const [k, v] of Object.entries(params)) {
                  stringified[k] = v === null || v === undefined ? null : String(v);
                }
                // NACH navigate: pushState trägt keine Query — Params die
                // vor dem Push gesetzt werden, kleben an der ALTEN URL und
                // sind auf dem Ziel-Screen weg (actionForm-Prefill leer).
                // Bekannte Kante (bewusst offen): zielt die Action auf den
                // AKTUELLEN pathname, short-circuit't pushPath ohne die Query
                // zu leeren — die neuen Params mergen dann auf den alten
                // ?-String. Für Row-Actions praktisch nicht erreichbar
                // (Pfad differiert über entityId/screen).
                nav.setSearchParams(stringified);
              }
            },
            ...(actionVisible !== undefined && {
              isVisible: (row: ListRowViewModel) => evalFieldCondition(actionVisible, row.values),
            }),
          };
        }
        if (dispatcher === undefined) return null;
        if (action.kind !== "writeHandler" && action.kind !== undefined) return null;
        const writeAction = action as RowActionWriteHandler;
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
          },
          isVisible:
            writeActionVisible !== undefined
              ? (row: ListRowViewModel) => evalFieldCondition(writeActionVisible, row.values)
              : undefined,
        };
      })
      .filter((a: DataTableRowAction | null): a is DataTableRowAction => a !== null);
  }, [screen.rowActions, screen.entity, effectiveTranslate, dispatcher, nav, schema.screens]);

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
            await dispatcher.write(action.handler, payload);
          },
        };
      })
      .filter((a: ToolbarActionButton | null): a is ToolbarActionButton => a !== null);
  }, [screen.toolbarActions, effectiveTranslate, nav, dispatcher]);

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
        {rowsQuery.error.i18nKey}
      </Banner>
    );
  }

  // RenderList's onRowClick is a 1-arg callback; KumikoScreen's
  // 2-arg shape (row, entityName) is the public surface — thread the
  // screen's entity through here so callers don't have to re-derive
  // it.
  const wrappedOnRowClick =
    onRowClick !== undefined
      ? (row: ListRowViewModel) => onRowClick(row, screen.entity)
      : undefined;

  // Searchable-Default: explizite Author-Wahl gewinnt, sonst auto-on
  // wenn die Entity searchable Felder hat (sonst wäre die Toolbar-Bar
  // ein toter Slot — Server-Search-Index hat eh nichts zum Filtern).
  const searchable =
    screen.searchable ??
    Object.values(entity.fields).some((f) => "searchable" in f && f.searchable === true);

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
}: {
  readonly schema: FeatureSchema;
  readonly screen: ActionFormScreenDefinition;
  readonly translate?: Translate;
}): ReactNode {
  const nav = useNav();
  const synthEntity = useMemo(() => synthesizeActionFormEntity(screen.fields), [screen.fields]);
  const synthScreen = useMemo(() => synthesizeActionFormScreen(screen), [screen]);
  // Tier 2.7e-2: URL-Search-Params überschreiben Field-Defaults bei
  // initial values. Use-case: rowAction kind=navigate setzt
  // `?customerId=row-uuid` und der actionForm liest das pre-filled.
  // String-Coercion auf Field-Type: URL kennt nur Strings, aber
  // ein Field mit type:"number" erwartet eine Zahl. Boolean-Strings
  // ("true"/"false") und Number-Strings werden hier coerced; sonst
  // bleibt der String — der Field-Validator beim Submit fängt einen
  // Type-Mismatch ab.
  const initial = useMemo(() => {
    const defaults = buildInitialValues(screen.fields) as Record<string, unknown>; // @cast-boundary render-helper
    const merged: Record<string, unknown> = { ...defaults };
    for (const [name, fieldDef] of Object.entries(screen.fields)) {
      const raw = nav.searchParams[name];
      if (raw === undefined) continue;
      const ftype = (fieldDef as { type?: string }).type;
      if (ftype === "number" || ftype === "money") {
        const parsed = Number(raw);
        merged[name] = Number.isNaN(parsed) ? defaults[name] : parsed;
      } else if (ftype === "boolean") {
        merged[name] = raw === "true";
      } else {
        merged[name] = raw;
      }
    }
    return merged as FormValues;
  }, [screen.fields, nav.searchParams]);
  const handleSubmitted = useCallback(
    (result: SubmitResult<unknown>) => {
      // Redirect ist optional. Bei isSuccess + redirect → nav.navigate.
      // Author entscheidet bewusst ob "stay on form" (default) oder
      // "back to list" (typisch bei Create-style Aktionen).
      if (result.isSuccess && screen.redirect !== undefined) {
        nav.navigate({ screenId: screen.redirect });
      }
    },
    [nav, screen.redirect],
  );
  // Cancel ist nur sinnvoll wenn ein Navigations-Ziel existiert —
  // sonst hätte der Button nirgendwo hin zu navigieren. cancelTarget
  // gewinnt über redirect; `false` schaltet den Button explizit ab
  // (Single-Action-Screens, wo Cancel nur Submit-ohne-Senden wäre).
  const handleCancel = useMemo<(() => void) | undefined>(() => {
    const target = screen.cancelTarget ?? screen.redirect;
    if (target === undefined || target === false) return undefined;
    return () => nav.navigate({ screenId: target });
  }, [nav, screen.redirect, screen.cancelTarget]);
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
        commands.push({
          type: "config:write:set",
          payload: { key: qualified, value, scope: screen.scope },
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
    [dispatcher, screen.configKeys, screen.scope, valuesQuery.refetch, cascadeQuery.refetch],
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
        {valuesQuery.error.i18nKey}
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
