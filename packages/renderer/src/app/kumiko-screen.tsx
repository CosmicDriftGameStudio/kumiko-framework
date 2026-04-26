import type {
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
  ScreenDefinition,
} from "@kumiko/framework/ui-types";
import type { FormValues, ListRowViewModel, SubmitResult, Translate } from "@kumiko/headless";
import { type ReactNode, useCallback, useMemo } from "react";
import { RenderEdit } from "../components/render-edit";
import { RenderList } from "../components/render-list";
import { useDispatcher } from "../context/dispatcher-context";
import { useListUrlState } from "../hooks/use-list-url-state";
import { useQuery } from "../hooks/use-query";
import { usePrimitives } from "../primitives";
import { useCustomScreenComponent } from "./custom-screens";
import type { FeatureSchema } from "./feature-schema";
import { useNav } from "./nav";

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

export function KumikoScreen({
  schema,
  qn,
  translate,
  entityId,
  onRowClick,
}: KumikoScreenProps): ReactNode {
  const { Banner, Text } = usePrimitives();
  const screen = useMemo(
    () => schema.screens.find((s) => qualifyScreenId(schema.featureName, s.id) === qn),
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
    const list = schema.screens.find((s) => s.type === "entityList" && s.entity === entityName);
    if (!list) return;
    nav.navigate({ screenId: list.id });
  }, [nav, schema.screens, entityName]);
}

// Default "+ Neu"-Navigation für die List-Toolbar: findet den ersten
// entityEdit-Screen ohne entityId-Anhang und navigiert dorthin.
// Returns undefined wenn kein Edit-Screen registriert ist — RenderList
// rendert dann keinen + Neu Button.
function useNavigateToCreateFor(
  schema: FeatureSchema,
  entityName: string,
): (() => void) | undefined {
  const nav = useNav();
  const editScreenId = useMemo(() => {
    const edit = schema.screens.find((s) => s.type === "entityEdit" && s.entity === entityName);
    return edit?.id;
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
      writeCommand={writeCommand}
      payloadMode="changes"
      buildPayload={buildPayload}
      onSubmit={handleSubmitted}
      onDelete={handleDelete}
      onCancel={navigateToList}
      onReload={() => void onReload()}
      {...(translate !== undefined && { translate })}
    />
  );
}

// ---- entity-list ----

function entityQueryCommand(featureName: string, entity: string, verb: "list"): string {
  return `${featureName}:query:${entity}:${verb}`;
}

// Server-side entity-query-handlers return the paged envelope
// `{ rows, nextCursor }`. Narrow the useQuery generic to that shape so
// RenderList gets plain rows.
type PagedRows = {
  readonly rows: Readonly<Record<string, unknown>>[];
  readonly nextCursor: string | null;
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

  // URL-State: sort/dir/q/page leben unter dem screen.id-Namespace
  // (`/orders?orders.sort=createdAt&orders.dir=desc&orders.q=acme`),
  // damit zwei Lists auf derselben Route nicht über dieselben
  // Query-Keys streiten. Default-Sort aus der Screen-Def gewinnt nur
  // wenn URL keinen sort hat — Author-Default vs User-Choice.
  const urlState = useListUrlState(screen.id);
  const effectiveSort = urlState.sort ?? screen.defaultSort ?? null;
  const limit = screen.pageSize ?? 50;

  // Payload für den Server-Query-Handler (LIST_PAYLOAD_SCHEMA):
  // search/sort/sortDirection/limit. Pagination kommt cursor-basiert
  // (Tier 2.6d/e); für jetzt liefert der Server die erste Seite und
  // der Client rendert alles was ankommt.
  const queryPayload = useMemo(() => {
    const payload: Record<string, unknown> = { limit };
    if (urlState.q !== "") payload["search"] = urlState.q;
    if (effectiveSort !== null) {
      payload["sort"] = effectiveSort.field;
      payload["sortDirection"] = effectiveSort.dir;
    }
    return payload;
  }, [limit, urlState.q, effectiveSort]);

  const rowsQuery = useQuery<PagedRows>(queryType, queryPayload, { live: true });

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

  return (
    <RenderList
      screen={screen}
      entity={entity}
      rows={rowsQuery.data?.rows ?? []}
      featureName={featureName}
      searchable={searchable}
      searchValue={urlState.q}
      onSearchChange={urlState.setQ}
      sort={effectiveSort}
      onSortChange={urlState.setSort}
      {...(onCreate !== undefined && { onCreate })}
      {...(translate !== undefined && { translate })}
      {...(wrappedOnRowClick !== undefined && { onRowClick: wrappedOnRowClick })}
    />
  );
}

// Re-export the ScreenDefinition type so callers don't reach into
// framework/ui-types for a prop-type they need to narrow on.
export type { ScreenDefinition };
