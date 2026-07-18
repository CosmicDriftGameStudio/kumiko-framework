import type { ZodType, z } from "zod";
import { toTableName } from "../db/table-builder";
import type { QueryHandlerDefinition, WriteHandlerDefinition } from "./define-handler";
import { type RegisterEntityCrudOptions, registerEntityCrud } from "./entity-handlers";
import type { FeatureBuilderState } from "./feature-builder-state";
import { splitNamedDefinition } from "./object-form";
import type {
  AccessRule,
  EntityDefinition,
  EntityRef,
  FeatureRegistrar,
  HandlerRef,
  NameOrRef,
  QueryHandlerFn,
  RateLimitOption,
  RelationDefinition,
  WriteHandlerFn,
} from "./types";
import { resolveName } from "./types/handlers";
import type { PipelineDef } from "./types/step";

const CRUD_VERBS = new Set(["create", "update", "delete"]);

// Map handler name to entity via colon convention.
// "task:create" → entity "task". Bare CRUD verbs (create/update/delete) map
// when feature name matches an entity or the feature owns exactly one entity.
function tryMapEntity(state: FeatureBuilderState, name: string, handlerName: string): void {
  const colonIdx = handlerName.indexOf(":");
  if (colonIdx >= 0) {
    const candidate = handlerName.slice(0, colonIdx);
    if (state.entities[candidate]) {
      state.handlerEntityMappings[handlerName] = candidate;
    }
    // skip: colon-prefixed handler processed (mapped or not), bare CRUD path not applicable
    return;
  }
  if (CRUD_VERBS.has(handlerName)) {
    if (state.entities[name]) {
      state.handlerEntityMappings[handlerName] = name;
      // skip: feature-name entity match is the preferred mapping
      return;
    }
    const entityKeys = Object.keys(state.entities);
    if (entityKeys.length === 1) {
      state.handlerEntityMappings[handlerName] = entityKeys[0] as string;
    }
  }
}

// Builds entity/crud/relation/writeHandler/queryHandler — the registrar
// methods that create or reference entities. `crud` needs the fully-built
// registrar (self-reference into registerEntityCrud); getRegistrar is a lazy
// thunk since the registrar object doesn't exist yet while this is composed.
export function buildEntityHandlerMethods<TName extends string>(
  state: FeatureBuilderState,
  name: TName,
  getRegistrar: () => FeatureRegistrar<TName>,
) {
  return {
    entity(
      nameOrDefinition: string | ({ readonly name: string } & EntityDefinition),
      definition?: EntityDefinition,
      options?: { readonly table?: unknown },
    ): EntityRef {
      const [entityName, entityDefinition] =
        typeof nameOrDefinition === "string"
          ? [nameOrDefinition, definition as EntityDefinition]
          : splitNamedDefinition(nameOrDefinition);
      state.entities[entityName] = entityDefinition;
      if (options?.table !== undefined) state.entityTables[entityName] = options.table;
      return { name: entityName, table: entityDefinition.table ?? toTableName(entityName) };
    },
    crud(
      entityName: string,
      definition: EntityDefinition,
      options?: RegisterEntityCrudOptions,
    ): EntityRef {
      registerEntityCrud(getRegistrar(), entityName, definition, options);
      return { name: entityName, table: definition.table ?? toTableName(entityName) };
    },
    relation(
      entityRefOrDefinition:
        | NameOrRef
        | ({ readonly entity: NameOrRef; readonly name: string } & RelationDefinition),
      relationName?: string,
      definition?: RelationDefinition,
    ): void {
      const [entityRef, resolvedRelationName, resolvedDefinition] =
        typeof entityRefOrDefinition === "object" && "entity" in entityRefOrDefinition
          ? (() => {
              const { entity, name: innerName, ...rest } = entityRefOrDefinition;
              return [entity, innerName, rest as RelationDefinition] as const;
            })()
          : [entityRefOrDefinition, relationName as string, definition as RelationDefinition];
      const entityName = resolveName(entityRef);
      if (!state.relations[entityName]) state.relations[entityName] = {};
      state.relations[entityName][resolvedRelationName] = resolvedDefinition;
    },
    writeHandler<TName extends string, TSchema extends ZodType>(
      nameOrDef: string | WriteHandlerDefinition<TName, TSchema>,
      schema?: TSchema,
      handler?: WriteHandlerFn<z.infer<TSchema>>,
      options?: { access?: AccessRule; rateLimit?: RateLimitOption },
    ): HandlerRef {
      if (typeof nameOrDef === "object") {
        const def = nameOrDef;
        state.writeHandlers[def.name] = {
          name: def.name,
          schema: def.schema,
          // @cast-boundary engine-bridge — typed Dev-API's handler is
          // generic over the schema's parsed payload (`WriteEvent<output<TSchema>>`),
          // the storage form WriteHandlerFn carries `WriteEvent<unknown>`.
          // Function-arg variance: TS sees the typed handler as stricter
          // than the loose storage shape and rejects direct assignment.
          // The runtime value is identical — the cast crosses that boundary.
          // `satisfies` does not work here (it asserts assignability, which
          // is what fails). Explicit cast is the right tool.
          handler: def.handler as WriteHandlerFn,
          ...(def.access && { access: def.access }),
          ...(def.unsafeSkipTransitionGuard && { unsafeSkipTransitionGuard: true }),
          ...(def.rateLimit && { rateLimit: def.rateLimit }),
          // Forward the pipeline-build closure so boot-validators and
          // Designer/AI tooling can inspect the step list. Absent on
          // free-form handlers — defineWriteHandler only sets `perform`
          // when the author used the pipeline form. Variance cast
          // mirrors the handler-cast above: PipelineDef<output<TSchema>>
          // is stricter than PipelineDef<unknown> for the same reason.
          ...(def.perform !== undefined && {
            perform: def.perform as PipelineDef,
          }),
        };
        tryMapEntity(state, name, def.name);
        return { name: def.name };
      }
      if (!schema || !handler)
        throw new Error("writeHandler inline form requires schema + handler");
      state.writeHandlers[nameOrDef] = {
        name: nameOrDef,
        schema,
        handler: handler as WriteHandlerFn, // @cast-boundary engine-bridge
        ...(options?.access && { access: options.access }),
        ...(options?.rateLimit && { rateLimit: options.rateLimit }),
      };
      tryMapEntity(state, name, nameOrDef);
      return { name: nameOrDef };
    },
    queryHandler<TName extends string, TSchema extends ZodType>(
      nameOrDef: string | QueryHandlerDefinition<TName, TSchema>,
      schema?: TSchema,
      handler?: QueryHandlerFn<z.infer<TSchema>>,
      options?: { access?: AccessRule; rateLimit?: RateLimitOption },
    ): HandlerRef {
      if (typeof nameOrDef === "object") {
        const def = nameOrDef;
        state.queryHandlers[def.name] = {
          name: def.name,
          schema: def.schema,
          // @cast-boundary engine-bridge — typed Dev-API → erased internal storage
          handler: def.handler as QueryHandlerFn, // @cast-boundary engine-bridge
          ...(def.access && { access: def.access }),
          ...(def.rateLimit && { rateLimit: def.rateLimit }),
        };
        tryMapEntity(state, name, def.name);
        return { name: def.name };
      }
      if (!schema || !handler)
        throw new Error("queryHandler inline form requires schema + handler");
      state.queryHandlers[nameOrDef] = {
        name: nameOrDef,
        schema,
        handler: handler as QueryHandlerFn, // @cast-boundary engine-bridge
        ...(options?.access && { access: options.access }),
        ...(options?.rateLimit && { rateLimit: options.rateLimit }),
      };
      tryMapEntity(state, name, nameOrDef);
      return { name: nameOrDef };
    },
  };
}
