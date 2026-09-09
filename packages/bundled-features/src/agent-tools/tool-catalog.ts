import type {
  EntityDefinition,
  FieldDefinition,
  QueryHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { hasAccess } from "@cosmicdrift/kumiko-framework/engine";
import type {
  AgentManifest,
  AgentManifestEntity,
  AgentManifestHandler,
  AgentManifestScreen,
  AgentToolMode,
  RegistrySearchView,
  ToolCatalog,
  ToolCatalogOptions,
  ToolDefinition,
  ToolDispatchDescriptor,
} from "./types";

const FILTER_OPS = ["eq", "ne", "lt", "gt", "in"] as const;
const MAX_TOOL_NAME_LENGTH = 64;

/** Field types that declare `filterable` (per `packages/framework/src/engine/types/fields.ts`).
 *  Mapped to the JSON-Schema type an LLM tool-call argument should use. `undefined` = field type
 *  is skipped for exact-lookup tools (not filterable at the type level). */
function jsonSchemaTypeForField(
  field: FieldDefinition,
): Readonly<Record<string, unknown>> | undefined {
  switch (field.type) {
    case "text":
    case "multiSelect":
    case "date":
    case "timestamp":
    case "locatedTimestamp":
      return { type: "string" };
    case "select":
      return { type: "string", enum: field.options };
    case "boolean":
      return { type: "boolean" };
    case "number":
    case "bigInt":
    case "decimal":
    case "money":
      return { type: "number" };
    case "reference":
      return { type: "string", description: `ID referencing "${field.entity}"` };
    default:
      return undefined;
  }
}

function isFilterable(field: FieldDefinition): boolean {
  return "filterable" in field && field.filterable === true;
}

function buildSearchTool(entityName: string, searchableFields: readonly string[]): ToolDefinition {
  return {
    name: `search_${entityName}`,
    description: `Full-text search over ${entityName} across fields: ${searchableFields.join(", ")}. Returns ranked candidates, not a single answer — may need a follow-up find_${entityName}_by_* call to disambiguate.`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text search query" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  };
}

function buildFindByTool(
  entityName: string,
  fieldName: string,
  fieldSchema: Readonly<Record<string, unknown>>,
): ToolDefinition {
  return {
    name: `find_${entityName}_by_${fieldName}`,
    description: `Exact lookup of ${entityName} where ${fieldName} matches.`,
    inputSchema: {
      type: "object",
      properties: { [fieldName]: fieldSchema },
      required: [fieldName],
      additionalProperties: false,
    },
  };
}

/** True for a `:list`-verb entity query handler, e.g. "my-feature:query:vendor:list" for entity
 *  "vendor" — the only handler shape whose payload accepts `search`/`filter` (see
 *  `packages/framework/src/db/event-store-executor-read.ts`). Handler-first iteration, not
 *  name-reconstruction: `entityName` here always comes from `registry.getHandlerEntity(qn)`,
 *  the registry's own answer for this exact qn, never guessed from kebab-casing rules. */
function isListHandlerQn(qn: string, entityName: string): boolean {
  return qn.endsWith(`:${entityName}:list`);
}

function isDetailHandlerQn(qn: string, entityName: string): boolean {
  return qn.endsWith(`:${entityName}:detail`);
}

/** #2700: the entity CRUD tools are enumerated off the registry, not off the manifest, so
 *  `resolveAgentExposure` never runs for them. Only an EXPLICIT opt-out may hide one here —
 *  the resolver's own default is fail-closed on a missing `description`, and CRUD-generated
 *  handlers never carry one, so reusing it would delete every entity tool in every app. */
function isExplicitlyAgentHidden(def: QueryHandlerDef): boolean {
  return def.agent?.expose === false;
}

function addToolsForListHandler(
  registry: RegistrySearchView,
  qn: string,
  entityName: string,
  entity: EntityDefinition,
  sink: CatalogSink,
): void {
  const searchableFields = registry.getSearchableFields(entityName);
  if (searchableFields.length > 0) {
    const tool = buildSearchTool(entityName, searchableFields);
    addTool(sink, tool, { kind: "search", entityName, qn });
  }

  for (const [fieldName, field] of Object.entries(
    entity.fields as Record<string, FieldDefinition>,
  )) {
    if (!isFilterable(field)) continue;
    const fieldSchema = jsonSchemaTypeForField(field);
    if (!fieldSchema) continue;
    const tool = buildFindByTool(entityName, fieldName, fieldSchema);
    addTool(sink, tool, { kind: "findBy", entityName, fieldName, qn });
  }
}

function entityDisplayLabel(
  entity: AgentManifestEntity | undefined,
  entityName: string,
  locale: string,
): string {
  if (entity?.description) return entity.description;
  const label = entity?.labels[locale];
  if (label) return label;
  return entityName;
}

function buildGetTool(
  entityName: string,
  qn: string,
  label: string,
): { tool: ToolDefinition; descriptor: ToolDispatchDescriptor } {
  return {
    tool: {
      name: `get_${entityName}`,
      description: `Fetch a single ${label} by its id.`,
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "Record id (uuid)" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
    descriptor: { kind: "server", op: "query", qn, risk: "low", entity: entityName, detail: true },
  };
}

function buildListInputSchema(
  searchableFields: readonly string[],
  filterableFields: readonly string[],
): Readonly<Record<string, unknown>> {
  const properties: Record<string, unknown> = {};
  if (searchableFields.length > 0) {
    properties["search"] = {
      type: "string",
      description: `Free-text search over: ${searchableFields.join(", ")}`,
    };
  }
  if (filterableFields.length > 0) {
    properties["filters"] = {
      type: "array",
      description: `Filters combined with AND. Filterable fields: ${filterableFields.join(", ")}`,
      items: {
        type: "object",
        properties: {
          field: { type: "string", enum: filterableFields },
          op: { type: "string", enum: FILTER_OPS },
          value: {},
        },
        required: ["field", "op", "value"],
        additionalProperties: false,
      },
    };
  }
  properties["limit"] = { type: "integer", minimum: 1, maximum: 200 };
  return { type: "object", properties, required: [], additionalProperties: false };
}

function buildListTool(
  entityName: string,
  qn: string,
  label: string,
  searchableFields: readonly string[],
  filterableFields: readonly string[],
): { tool: ToolDefinition; descriptor: ToolDispatchDescriptor } {
  const descriptionParts = [`List ${label} records.`];
  if (searchableFields.length > 0) {
    descriptionParts.push(`Free-text search over: ${searchableFields.join(", ")}.`);
  }
  if (filterableFields.length > 0) {
    descriptionParts.push(`Filterable fields: ${filterableFields.join(", ")}.`);
  }
  descriptionParts.push("The result carries a total count.");

  return {
    tool: {
      name: `list_${entityName}`,
      description: descriptionParts.join(" "),
      inputSchema: buildListInputSchema(searchableFields, filterableFields),
    },
    descriptor: {
      kind: "server",
      op: "query",
      qn,
      risk: "low",
      entity: entityName,
      list: { searchableFields, filterableFields },
    },
  };
}

function filterableFieldsOf(entity: AgentManifestEntity | undefined): readonly string[] {
  if (!entity) return [];
  return entity.fields.filter((field) => field.filterable === true).map((field) => field.name);
}

function compareByCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaRequiresField(schema: Readonly<Record<string, unknown>>, field: string): boolean {
  const required = schema["required"];
  return Array.isArray(required) && required.includes(field);
}

/** Strips `field` from both `properties` and `required` of a JSON Schema object — used to
 *  remove `version` from a write tool's model-facing input schema when dispatch injects it
 *  itself (read fresh from the paired detail handler right before the optimistic-lock write). */
function stripFieldFromSchema(
  schema: Readonly<Record<string, unknown>>,
  field: string,
): Readonly<Record<string, unknown>> {
  const { properties, required, ...rest } = schema;
  const strippedProperties = isRecord(properties)
    ? Object.fromEntries(Object.entries(properties).filter(([key]) => key !== field))
    : properties;
  const strippedRequired = Array.isArray(required)
    ? required.filter((entry) => entry !== field)
    : required;
  return { ...rest, properties: strippedProperties, required: strippedRequired };
}

function handlerDescription(handler: AgentManifestHandler): string {
  return handler.description.length > 0 ? handler.description : `Run ${handler.qn}.`;
}

/** Drops the `query`/`write` verb segment from a handler QN, joins the rest with `_`, and
 *  sanitizes to a valid tool-call identifier. Only the FIRST matching segment is dropped —
 *  QNs are `<feature>:query|write:<entity>:<verb>`, so the verb only ever appears once at that
 *  position; a blanket filter could accidentally eat a legitimately-named later segment. */
export function toolNameForQn(qn: string): string {
  const segments = qn.split(":");
  const verbIndex = segments.findIndex((segment) => segment === "query" || segment === "write");
  if (verbIndex !== -1) segments.splice(verbIndex, 1);
  const joined = segments.join("_");
  const sanitized = joined.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_");
  return sanitized.slice(0, MAX_TOOL_NAME_LENGTH);
}

export const OPEN_FORM_TOOL_NAME = "open_form";

function buildNavigateTool(manifest: AgentManifest): {
  tool: ToolDefinition;
  descriptor: ToolDispatchDescriptor;
} {
  const entityScreens = new Map<string, string>();
  for (const screen of manifest.screens) {
    if (screen.detailFor !== undefined && !entityScreens.has(screen.detailFor)) {
      entityScreens.set(screen.detailFor, screen.id);
    }
  }
  // A screen is navigable iff it is present in the role-filtered manifest — do not filter
  // additionally on `workspaces`. `buildScreens` gives detail screens (which have no nav
  // pointing at them) `workspaces: []`, and the `{entity,id}` form is exactly the detail-screen
  // case, so a `workspaces.length > 0` filter would reject every legitimate navigate.
  const screenIds = new Set(manifest.screens.map((screen: AgentManifestScreen) => screen.id));
  const sortedScreenIds = [...screenIds].sort(compareByCodePoint);

  return {
    tool: {
      name: "navigate",
      description:
        "Navigate the UI. Either { entity, id } to open an entity's detail screen, or " +
        "{ screenId, params } to open a specific screen.",
      inputSchema: {
        type: "object",
        properties: {
          entity: { type: "string", description: "Entity name; resolved to its detail screen." },
          id: { type: "string", description: "Record id, required with `entity`." },
          screenId: { type: "string", enum: sortedScreenIds },
          params: { type: "object", additionalProperties: { type: "string" } },
        },
        required: [],
        additionalProperties: false,
      },
    },
    descriptor: { kind: "client", op: "navigate", entityScreens, screenIds },
  };
}

function buildFormScreens(manifest: AgentManifest): ReadonlyMap<string, string> {
  const formScreens = new Map<string, string>();
  for (const screen of manifest.screens) {
    if (screen.type === "actionForm" && screen.handler !== undefined) {
      formScreens.set(screen.handler, screen.id);
    }
  }
  for (const screen of manifest.screens) {
    if (screen.type !== "entityEdit" || screen.entity === undefined) continue;
    for (const handler of manifest.handlers) {
      if (handler.kind !== "write") continue;
      if (
        handler.qn.endsWith(`:${screen.entity}:create`) ||
        handler.qn.endsWith(`:${screen.entity}:update`)
      ) {
        formScreens.set(handler.qn, screen.id);
      }
    }
  }
  return formScreens;
}

function buildAskUserTool(): { tool: ToolDefinition; descriptor: ToolDispatchDescriptor } {
  return {
    tool: {
      name: "ask_user",
      description: "Ask the user a clarifying question, optionally offering suggested answers.",
      inputSchema: {
        type: "object",
        properties: {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
        },
        required: ["question"],
        additionalProperties: false,
      },
    },
    descriptor: { kind: "client", op: "ask_user" },
  };
}

type CatalogSink = {
  readonly tools: ToolDefinition[];
  readonly dispatchTable: Map<string, ToolDispatchDescriptor>;
  readonly usedNames: Set<string>;
};

function claimDispatchName(
  sink: CatalogSink,
  name: string,
  descriptor: ToolDispatchDescriptor,
): boolean {
  if (sink.usedNames.has(name)) return false;
  sink.dispatchTable.set(name, descriptor);
  sink.usedNames.add(name);
  return true;
}

function addTool(
  sink: CatalogSink,
  tool: ToolDefinition,
  descriptor: ToolDispatchDescriptor,
): void {
  if (claimDispatchName(sink, tool.name, descriptor)) sink.tools.push(tool);
}

function addRegistrySearchTools(
  registry: RegistrySearchView,
  roleFilter: { roles: readonly string[] },
  denyQns: ReadonlySet<string>,
  sink: CatalogSink,
): void {
  for (const [qn, def] of registry.getAllQueryHandlers()) {
    const entityName = registry.getHandlerEntity(qn);
    if (!entityName || !isListHandlerQn(qn, entityName)) continue;
    if (denyQns.has(qn) || isExplicitlyAgentHidden(def)) continue;
    if (!hasAccess(roleFilter, def.access)) continue;

    const entity = registry.getEntity(entityName);
    if (!entity) continue;

    addToolsForListHandler(registry, qn, entityName, entity, sink);
  }
}

type EntityHandlerQns = {
  readonly detailQnByEntity: ReadonlyMap<string, string>;
  readonly listQnByEntity: ReadonlyMap<string, string>;
  readonly entityListDetailQns: ReadonlySet<string>;
};

function collectEntityHandlerQns(
  registry: RegistrySearchView,
  roleFilter: { roles: readonly string[] },
  denyQns: ReadonlySet<string>,
): EntityHandlerQns {
  const detailQnByEntity = new Map<string, string>();
  const listQnByEntity = new Map<string, string>();
  // Structural set (role-independent): every qn shaped like an entity list/detail handler, used
  // to keep query-handler tools from ever double-registering a handler already covered by get_/list_.
  const entityListDetailQns = new Set<string>();
  for (const [qn] of registry.getAllQueryHandlers()) {
    const entityName = registry.getHandlerEntity(qn);
    if (!entityName) continue;
    if (isDetailHandlerQn(qn, entityName)) entityListDetailQns.add(qn);
    if (isListHandlerQn(qn, entityName)) entityListDetailQns.add(qn);
  }
  for (const [qn, def] of registry.getAllQueryHandlers()) {
    const entityName = registry.getHandlerEntity(qn);
    if (!entityName || !hasAccess(roleFilter, def.access)) continue;
    if (denyQns.has(qn) || isExplicitlyAgentHidden(def)) continue;
    if (isDetailHandlerQn(qn, entityName)) detailQnByEntity.set(entityName, qn);
    if (isListHandlerQn(qn, entityName)) listQnByEntity.set(entityName, qn);
  }
  return { detailQnByEntity, listQnByEntity, entityListDetailQns };
}

function addGetTools(
  detailQnByEntity: ReadonlyMap<string, string>,
  entityByName: ReadonlyMap<string, AgentManifestEntity>,
  locale: string,
  sink: CatalogSink,
): void {
  const getEntries = [...detailQnByEntity.entries()].sort((a, b) => compareByCodePoint(a[0], b[0]));
  for (const [entityName, qn] of getEntries) {
    const label = entityDisplayLabel(entityByName.get(entityName), entityName, locale);
    const { tool, descriptor } = buildGetTool(entityName, qn, label);
    addTool(sink, tool, descriptor);
  }
}

function addListTools(
  registry: RegistrySearchView,
  listQnByEntity: ReadonlyMap<string, string>,
  entityByName: ReadonlyMap<string, AgentManifestEntity>,
  locale: string,
  sink: CatalogSink,
): void {
  const listEntries = [...listQnByEntity.entries()].sort((a, b) => compareByCodePoint(a[0], b[0]));
  for (const [entityName, qn] of listEntries) {
    const label = entityDisplayLabel(entityByName.get(entityName), entityName, locale);
    const searchableFields = registry.getSearchableFields(entityName);
    const filterableFields = filterableFieldsOf(entityByName.get(entityName));
    const { tool, descriptor } = buildListTool(
      entityName,
      qn,
      label,
      searchableFields,
      filterableFields,
    );
    addTool(sink, tool, descriptor);
  }
}

function addQueryHandlerTools(
  manifest: AgentManifest,
  entityListDetailQns: ReadonlySet<string>,
  denyQns: ReadonlySet<string>,
  sink: CatalogSink,
): void {
  for (const handler of manifest.handlers) {
    if (handler.kind !== "query") continue;
    if (denyQns.has(handler.qn)) continue;
    if (entityListDetailQns.has(handler.qn)) continue;
    const name = toolNameForQn(handler.qn);

    addTool(
      sink,
      { name, description: handlerDescription(handler), inputSchema: handler.inputSchema },
      {
        kind: "server",
        op: "query",
        qn: handler.qn,
        risk: handler.risk,
        ...(handler.entity !== undefined && { entity: handler.entity }),
      },
    );
  }
}

function addWriteHandlerTools(
  manifest: AgentManifest,
  detailQnByEntity: ReadonlyMap<string, string>,
  denyQns: ReadonlySet<string>,
  sink: CatalogSink,
): void {
  for (const handler of manifest.handlers) {
    if (handler.kind !== "write") continue;
    if (denyQns.has(handler.qn)) continue;
    const name = toolNameForQn(handler.qn);

    const detailQn =
      handler.entity !== undefined ? detailQnByEntity.get(handler.entity) : undefined;
    const injectsVersion =
      detailQn !== undefined && schemaRequiresField(handler.inputSchema, "version");
    const inputSchema = injectsVersion
      ? stripFieldFromSchema(handler.inputSchema, "version")
      : handler.inputSchema;

    addTool(
      sink,
      { name, description: handlerDescription(handler), inputSchema },
      {
        kind: "server",
        op: "write",
        qn: handler.qn,
        risk: handler.risk,
        ...(handler.entity !== undefined && { entity: handler.entity }),
        ...(detailQn !== undefined && { detailQn }),
        ...(injectsVersion && { injectsVersion: true as const }),
      },
    );
  }
}

function addClientTools(manifest: AgentManifest, mode: AgentToolMode, sink: CatalogSink): void {
  // Same precedence rule as every loop above: a name already claimed by a handler-derived tool
  // wins, and a built-in never overwrites it — only the order differs (built-ins run last).
  const navigate = buildNavigateTool(manifest);
  addTool(sink, navigate.tool, navigate.descriptor);

  // open_form is dispatch-only by design: the approval layer triggers it, the model never calls it.
  if (mode !== "read-only") {
    claimDispatchName(sink, OPEN_FORM_TOOL_NAME, {
      kind: "client",
      op: "open_form",
      formScreens: buildFormScreens(manifest),
    });
  }

  const askUser = buildAskUserTool();
  addTool(sink, askUser.tool, askUser.descriptor);
}

/** Registry snapshot + role-filtered manifest → agent tool catalog. Pure, deterministic, no I/O
 *  — every tool here is a name+schema only; `tool-dispatch.ts` is what actually calls a
 *  permission-checked handler when the LLM invokes one of these by name.
 *
 *  `search_<entity>` / `find_<entity>_by_<field>` iterate mounted `:list` handlers directly off
 *  the registry (unchanged from the original design). `get_<entity>` / `list_<entity>` are also
 *  enumerated from the registry rather than `manifest.handlers`, because entity CRUD handlers
 *  carry no `description`/`agent` and are therefore never role-exposed into the manifest (see
 *  `resolveAgentExposure`) — the manifest can't tell us these handlers exist at all. Every other
 *  tool (custom query/write handlers, navigate/open_form/ask_user) is manifest-derived, since
 *  the manifest already carries the role-filtered handler/screen shape needed for those. Roles
 *  and locale both come from the manifest (`manifest.builtForRoles` / `manifest.tenantSettings.locale`)
 *  so the registry-derived and manifest-derived halves share one source and cannot disagree.
 *
 *  `options.denyQns` is the app-side cut, applied to both halves: it is the only way to keep a
 *  handler out of the catalog that the app does not own (a bundled feature's), and the only way
 *  to drop an entity CRUD tool, which no `agent.expose` on the manifest side can reach. It is
 *  NOT read off the manifest on purpose — the manifest is prompt payload, and a list of the
 *  handlers the model may not call has no business travelling to the provider. Pass the same
 *  list to `buildAgentManifest` so the manifest stops describing what the catalog withholds. */
export function buildToolCatalog(
  registry: RegistrySearchView,
  manifest: AgentManifest,
  options: ToolCatalogOptions,
): ToolCatalog {
  const sink: CatalogSink = { tools: [], dispatchTable: new Map(), usedNames: new Set() };
  const roleFilter = { roles: manifest.builtForRoles };
  const locale = manifest.tenantSettings.locale;
  const entityByName = new Map(manifest.entities.map((entity) => [entity.name, entity]));
  const denyQns = new Set(options.denyQns ?? []);

  addRegistrySearchTools(registry, roleFilter, denyQns, sink);
  const { detailQnByEntity, listQnByEntity, entityListDetailQns } = collectEntityHandlerQns(
    registry,
    roleFilter,
    denyQns,
  );
  addGetTools(detailQnByEntity, entityByName, locale, sink);
  addListTools(registry, listQnByEntity, entityByName, locale, sink);
  addQueryHandlerTools(manifest, entityListDetailQns, denyQns, sink);
  if (options.mode !== "read-only") {
    addWriteHandlerTools(manifest, detailQnByEntity, denyQns, sink);
  }
  addClientTools(manifest, options.mode, sink);

  return { tools: sink.tools, dispatchTable: sink.dispatchTable };
}
