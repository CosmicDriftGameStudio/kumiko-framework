import type { EntityDefinition, FieldDefinition } from "@cosmicdrift/kumiko-framework/engine";
import type {
  RegistrySearchView,
  ToolCatalog,
  ToolDefinition,
  ToolDispatchDescriptor,
} from "./types";

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

function addToolsForListHandler(
  registry: RegistrySearchView,
  qn: string,
  entityName: string,
  entity: EntityDefinition,
  tools: ToolDefinition[],
  dispatchTable: Map<string, ToolDispatchDescriptor>,
): void {
  const searchableFields = registry.getSearchableFields(entityName);
  if (searchableFields.length > 0) {
    const tool = buildSearchTool(entityName, searchableFields);
    tools.push(tool);
    dispatchTable.set(tool.name, { kind: "search", entityName, qn });
  }

  for (const [fieldName, field] of Object.entries(
    entity.fields as Record<string, FieldDefinition>,
  )) {
    if (!isFilterable(field)) continue;
    const fieldSchema = jsonSchemaTypeForField(field);
    if (!fieldSchema) continue;
    const tool = buildFindByTool(entityName, fieldName, fieldSchema);
    tools.push(tool);
    dispatchTable.set(tool.name, { kind: "findBy", entityName, fieldName, qn });
  }
}

/** Registry snapshot → agent tool catalog. Pure, deterministic, no I/O, no permission check —
 *  every tool here is a name+schema only; `tool-dispatch.ts` is what actually calls a
 *  permission-checked query handler when the LLM invokes one of these by name. Iterates mounted
 *  `:list` handlers (not `getAllEntities()`) so the catalog never advertises a tool for an entity
 *  that has no callable list handler — a wasted tool-call the LLM would just fail on. */
export function buildToolCatalog(registry: RegistrySearchView): ToolCatalog {
  const tools: ToolDefinition[] = [];
  const dispatchTable = new Map<string, ToolDispatchDescriptor>();

  for (const [qn] of registry.getAllQueryHandlers()) {
    const entityName = registry.getHandlerEntity(qn);
    if (!entityName || !isListHandlerQn(qn, entityName)) continue;

    const entity = registry.getEntity(entityName);
    if (!entity) continue;

    addToolsForListHandler(registry, qn, entityName, entity, tools, dispatchTable);
  }

  return { tools, dispatchTable };
}
