import type { KumikoEventTypeMap } from "@cosmicdrift/kumiko-types/event-type-map";
import type { EntityObjectDefinition } from "@cosmicdrift/kumiko-types/feature-registrar";
import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import type {
  AccessRule,
  AgentHandlerHints,
  BeforeTransactionPhase,
  BeforeTransactionWhenNested,
  EntityRef,
  EscapeHatchDeclaration,
  HandlerRef,
  NameOrRef,
  QueryHandlerFn,
  RateLimitDeclaration,
  StreamHandlerFn,
  WriteHandlerFn,
} from "@cosmicdrift/kumiko-types/handlers";
import { ENTITY_CONVENTION_QUERY_BRAND } from "@cosmicdrift/kumiko-types/handlers";
import type { RelationDefinition } from "@cosmicdrift/kumiko-types/relations";
import type * as z from "zod";
import type { ZodType } from "zod";
import { toTableName } from "../db/table-builder.ts";
import {
  isEntityConventionQueryHandler,
  isPagedQueryHandler,
  PAGED_QUERY_HANDLER_BRAND,
  type QueryHandlerDefinition,
  type StreamHandlerDefinition,
  type WriteHandlerDefinition,
} from "./define-handler.ts";
import type { RegisterEntityCrudOptions } from "./entity-handlers.ts";
import {
  assertEscapeHatchAccessIsSystemAdminOnly,
  registerCrudHandlers,
} from "./entity-handlers.ts";
import type { FeatureBuilderState } from "./feature-builder-state.ts";
import { resolveName } from "./handler-helpers.ts";
import { isObjectArgument, requireArgument, throwObjectArgumentRequired } from "./object-form.ts";

import type { PipelineDef } from "./types/step.ts";

const CRUD_VERBS = new Set(["create", "update", "delete"]);
const CRUD_REGISTERED_VERBS = new Set([...CRUD_VERBS, "restore", "list", "detail"]);

// A silent overwrite would drop framework behaviour that rides on the r.crud
// handlers (e.g. writeOnly masking), so a same-name registration fails loudly.
function assertHandlerNameFree(
  state: FeatureBuilderState,
  featureName: string,
  kind: "write" | "query",
  handlerName: string,
): void {
  const registered = kind === "write" ? state.writeHandlers : state.queryHandlers;
  // skip: a free name is the normal case
  if (!Object.hasOwn(registered, handlerName)) return;
  const [entityName, verb] = handlerName.split(":");
  const crudShaped =
    entityName !== undefined &&
    verb !== undefined &&
    state.entities[entityName] !== undefined &&
    CRUD_REGISTERED_VERBS.has(verb);
  throw new Error(
    `Feature "${featureName}" registers the ${kind} handler "${handlerName}" twice.` +
      (crudShaped
        ? ` r.crud("${entityName}", ...) already registers that name; use a distinct name or drop the "${verb}" verb from r.crud.`
        : " Use a distinct name."),
  );
}

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
    const [onlyEntityName, ...otherEntityNames] = Object.keys(state.entities);
    if (onlyEntityName !== undefined && otherEntityNames.length === 0) {
      state.handlerEntityMappings[handlerName] = onlyEntityName;
    }
  }
}

function agentSlots(source: {
  readonly description?: string;
  readonly agent?: AgentHandlerHints;
}): { description?: string; agent?: AgentHandlerHints } {
  return {
    ...(source.description !== undefined && { description: source.description }),
    ...(source.agent && { agent: source.agent }),
  };
}

function transactionPhaseSlots<
  TSchema extends ZodType,
  TPrepared,
  TWhenNested extends BeforeTransactionWhenNested | undefined,
>(
  def: Pick<
    WriteHandlerDefinition<string, TSchema, unknown, KumikoEventTypeMap, TPrepared, TWhenNested>,
    "reserveBeforeTransaction" | "beforeTransaction" | "beforeTransactionWhenNested" | "transaction"
  >,
) {
  return {
    ...(def.reserveBeforeTransaction && {
      reserveBeforeTransaction: def.reserveBeforeTransaction,
    }),
    ...(def.beforeTransaction && {
      beforeTransaction: def.beforeTransaction as BeforeTransactionPhase, // @cast-boundary engine-bridge
    }),
    ...(def.beforeTransactionWhenNested && {
      beforeTransactionWhenNested: def.beforeTransactionWhenNested,
    }),
    ...(def.transaction && { transaction: def.transaction }),
  };
}

// Typed callers cannot omit `access`; untyped ones (JS, designer output) must not get a
// handler that silently falls through to the boot-time default-deny.
function assertHandlerHasAccess(
  featureName: string,
  method: "writeHandler" | "queryHandler" | "streamHandler",
  handlerName: string,
  access: unknown,
): void {
  if (access === undefined || access === null) {
    throw new Error(
      `[Feature ${featureName}] r.${method}({ name: "${handlerName}" }) requires an access rule (access: { roles: [...] } or { openToAll: { reason } })`,
    );
  }
}

function requireInlineHandlerArgs<TSchema, THandler, TOptions extends { access?: unknown }>(
  kind: string,
  schema: TSchema | undefined,
  handler: THandler | undefined,
  options: TOptions | undefined,
): { schema: TSchema; handler: THandler; options: TOptions } {
  if (!schema || !handler || !options?.access) {
    throw new Error(`${kind} inline form requires schema + handler + options.access`);
  }
  return { schema, handler, options };
}

// Builds entity/relation/writeHandler/queryHandler — the registrar
// methods that create or reference entities.
export function buildEntityHandlerMethods<TName extends string>(
  state: FeatureBuilderState,
  name: TName,
) {
  const methods = {
    entity(definition: EntityObjectDefinition): EntityRef {
      if (!isObjectArgument(definition)) throwObjectArgumentRequired(name, "entity");
      const { name: entityName, backingTable, ...entityDefinition } = definition;
      state.entities[entityName] = entityDefinition;
      if (backingTable !== undefined) state.entityTables[entityName] = backingTable;
      return { name: entityName, table: entityDefinition.table ?? toTableName(entityName) };
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
              return [entity, innerName, rest] as const;
            })()
          : [
              entityRefOrDefinition,
              requireArgument(relationName, name, "relation", "relation name"),
              requireArgument(definition, name, "relation", "definition"),
            ];
      const entityName = resolveName(entityRef);
      if (!state.relations[entityName]) state.relations[entityName] = {};
      state.relations[entityName][resolvedRelationName] = resolvedDefinition;
    },
    writeHandler<
      TName extends string,
      TSchema extends ZodType,
      TPrepared = undefined,
      TWhenNested extends BeforeTransactionWhenNested | undefined = undefined,
    >(
      def: WriteHandlerDefinition<
        TName,
        TSchema,
        unknown,
        KumikoEventTypeMap,
        TPrepared,
        TWhenNested
      >,
    ): HandlerRef {
      if (!isObjectArgument(def)) throwObjectArgumentRequired(name, "writeHandler");
      assertHandlerHasAccess(name, "writeHandler", def.name, def.access);
      assertHandlerNameFree(state, name, "write", def.name);
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
        access: def.access,
        ...agentSlots(def),
        ...(def.excludedFields && { excludedFields: def.excludedFields }),
        ...(def.unsafeSkipTransitionGuard && { unsafeSkipTransitionGuard: true }),
        ...(def.rateLimit && { rateLimit: def.rateLimit }),
        ...(def.additionalRateLimits && { additionalRateLimits: def.additionalRateLimits }),
        ...(def.rateLimitCost && {
          rateLimitCost: def.rateLimitCost as (payload: unknown) => number, // @cast-boundary engine-bridge
        }),
        ...(def.escapeHatch && { escapeHatch: def.escapeHatch }),
        ...transactionPhaseSlots(def),
        ...(def.tenantlessAnonymous && { tenantlessAnonymous: true }),
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
    },
    queryHandler<TName extends string, TSchema extends ZodType>(
      def: QueryHandlerDefinition<TName, TSchema>,
    ): HandlerRef {
      if (!isObjectArgument(def)) throwObjectArgumentRequired(name, "queryHandler");
      assertHandlerHasAccess(name, "queryHandler", def.name, def.access);
      assertHandlerNameFree(state, name, "query", def.name);
      // A generated entity handler checks its escapeHatch when it is built, but a
      // spread of it can add escapeHatch afterwards; the registered object is
      // what the dispatcher trusts, so the check runs on it again.
      if (def.escapeHatch !== undefined && isEntityConventionQueryHandler(def)) {
        assertEscapeHatchAccessIsSystemAdminOnly(def.name, "query", def.access);
      }
      state.queryHandlers[def.name] = {
        name: def.name,
        schema: def.schema,
        // @cast-boundary engine-bridge — typed Dev-API → erased internal storage
        handler: def.handler as QueryHandlerFn, // @cast-boundary engine-bridge
        access: def.access,
        ...agentSlots(def),
        ...(def.rateLimit && { rateLimit: def.rateLimit }),
        ...(def.outputSchema && { outputSchema: def.outputSchema }),
        ...(def.liveEntities && { liveEntities: def.liveEntities }),
        ...(def.escapeHatch && { escapeHatch: def.escapeHatch }),
        // Carry the definePagedQueryHandler brand through — this rebuild
        // drops any field not explicitly listed.
        ...(isPagedQueryHandler(def) && { [PAGED_QUERY_HANDLER_BRAND]: true }),
        ...(isEntityConventionQueryHandler(def) && {
          [ENTITY_CONVENTION_QUERY_BRAND]: true as const,
        }),
      };
      tryMapEntity(state, name, def.name);
      return { name: def.name };
    },
    streamHandler<TName extends string, TSchema extends ZodType>(
      nameOrDef: string | StreamHandlerDefinition<TName, TSchema>,
      schema?: TSchema,
      handler?: StreamHandlerFn<z.infer<TSchema>>,
      options?: {
        access: AccessRule;
        rateLimit?: RateLimitDeclaration;
        escapeHatch?: EscapeHatchDeclaration;
      },
    ): HandlerRef {
      if (typeof nameOrDef === "object") {
        const def = nameOrDef;
        assertHandlerHasAccess(name, "streamHandler", def.name, def.access);
        state.streamHandlers[def.name] = {
          name: def.name,
          schema: def.schema,
          // @cast-boundary engine-bridge — typed Dev-API → erased internal storage
          handler: def.handler as StreamHandlerFn, // @cast-boundary engine-bridge
          access: def.access,
          ...(def.rateLimit && { rateLimit: def.rateLimit }),
          ...(def.escapeHatch && { escapeHatch: def.escapeHatch }),
        };
        return { name: def.name };
      }
      const inline = requireInlineHandlerArgs("streamHandler", schema, handler, options);
      state.streamHandlers[nameOrDef] = {
        name: nameOrDef,
        schema: inline.schema,
        handler: inline.handler as StreamHandlerFn, // @cast-boundary engine-bridge
        access: inline.options.access,
        ...(inline.options.rateLimit && { rateLimit: inline.options.rateLimit }),
        ...(inline.options.escapeHatch && { escapeHatch: inline.options.escapeHatch }),
      };
      return { name: nameOrDef };
    },
  };
  return {
    ...methods,
    crud(entityName: string, entity: EntityDefinition, options?: RegisterEntityCrudOptions): void {
      registerCrudHandlers(methods, entityName, entity, options);
    },
  };
}
