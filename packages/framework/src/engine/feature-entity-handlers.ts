import type { KumikoEventTypeMap } from "@cosmicdrift/kumiko-types/event-type-map";
import type { EntityObjectDefinition } from "@cosmicdrift/kumiko-types/feature-registrar";
import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import { queryContract } from "@cosmicdrift/kumiko-types/handler-contract";
import type {
  BeforeTransactionWhenNested,
  EntityRef,
  HandlerRef,
  NameOrRef,
  QueryHandlerFn,
  QueryHandlerRef,
  StreamHandlerFn,
  WriteHandlerFn,
} from "@cosmicdrift/kumiko-types/handlers";
import {
  ENTITY_CONVENTION_QUERY_BRAND,
  ENTITY_CONVENTION_WRITE_BRAND,
} from "@cosmicdrift/kumiko-types/handlers";
import type { RelationDefinition } from "@cosmicdrift/kumiko-types/relations";
import type { WriteFailure } from "@cosmicdrift/kumiko-types/write-error-info-types";
import type * as z from "zod";
import type { ZodType } from "zod";
import { toTableName } from "../db/table-builder.ts";
import { bootRuleError } from "./boot-validator/boot-rule.ts";
import { DEFINITION_HANDLER_RULES } from "./boot-validator/definition-handlers-rules.ts";
import { HANDLER_ACCESS_RULES } from "./boot-validator/entity-handler-access-rules.ts";
import {
  isEntityConventionQueryHandler,
  isEntityConventionWriteHandler,
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
import { assertReason } from "./escape-hatch-reason.ts";
import type { FeatureBuilderState } from "./feature-builder-state.ts";
import { agentSlots, transactionPhaseSlots } from "./handler-definition-slots.ts";
import { resolveName } from "./handler-helpers.ts";
import { qualifyQueryName } from "./qualified-name.ts";

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
  throw bootRuleError(DEFINITION_HANDLER_RULES.nameDuplicate, {
    message:
      `Feature "${featureName}" registers the ${kind} handler "${handlerName}" twice.` +
      (crudShaped
        ? ` r.crud() for "${entityName}" already registers that name; use a distinct name or drop the "${verb}" verb from r.crud.`
        : " Use a distinct name."),
  });
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

// Typed callers cannot omit `access`; untyped ones (JS, designer output) must not get a
// handler that silently falls through to the boot-time default-deny.
function assertHandlerHasAccess(
  featureName: string,
  method: "writeHandler" | "queryHandler" | "streamHandler",
  handlerName: string,
  access: unknown,
): void {
  if (access === undefined || access === null) {
    throw bootRuleError(HANDLER_ACCESS_RULES.accessMissing, {
      message: `[Feature ${featureName}] r.${method}({ name: "${handlerName}" }) requires an access rule (access: { roles: [...] } or { openToAll: { reason } })`,
    });
  }
}

// Builds entity/relation/writeHandler/queryHandler — the registrar
// methods that create or reference entities.
export function buildEntityHandlerMethods<TName extends string>(
  state: FeatureBuilderState,
  name: TName,
) {
  const methods = {
    entity(definition: EntityObjectDefinition): EntityRef {
      const { backingTable, ...entityDefinition } = definition;
      const entityName = entityDefinition.name;
      state.entities[entityName] = entityDefinition;
      if (backingTable !== undefined) state.entityTables[entityName] = backingTable;
      return { name: entityName, table: entityDefinition.table ?? toTableName(entityName) };
    },
    relation<TDef extends RelationDefinition>(
      definition: { readonly entity: NameOrRef; readonly name: string } & TDef,
    ): void {
      const {
        entity: entityRef,
        name: relationName,
        ...relationDefinition
      }: { readonly entity: NameOrRef; readonly name: string } & RelationDefinition = definition;
      const entityName = resolveName(entityRef);
      if (!state.relations[entityName]) state.relations[entityName] = {};
      state.relations[entityName][relationName] = relationDefinition;
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
        ...(isEntityConventionWriteHandler(def) && {
          [ENTITY_CONVENTION_WRITE_BRAND]: true as const,
        }),
        ...(def.excludedFields && { excludedFields: def.excludedFields }),
        ...(def.unsafeSkipTransitionGuard && { unsafeSkipTransitionGuard: true }),
        ...(def.rateLimit && { rateLimit: def.rateLimit }),
        ...(def.additionalRateLimits && { additionalRateLimits: def.additionalRateLimits }),
        ...(def.rateLimitCost && {
          rateLimitCost: def.rateLimitCost as (payload: unknown) => number, // @cast-boundary engine-bridge
        }),
        ...(def.escapeHatch && { escapeHatch: def.escapeHatch }),
        ...transactionPhaseSlots(def),
        ...(def.dispatchOnly && { dispatchOnly: true }),
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
    queryHandler<TName extends string, TSchema extends ZodType, TResult = unknown>(
      def: QueryHandlerDefinition<TName, TSchema, TResult>,
    ): QueryHandlerRef<z.input<TSchema>, Exclude<TResult, WriteFailure>> {
      assertHandlerHasAccess(name, "queryHandler", def.name, def.access);
      assertHandlerNameFree(state, name, "query", def.name);
      if (def.resultEntity !== undefined && def.unfilteredResult !== undefined) {
        throw new Error(
          `queryHandler "${def.name}" in feature "${name}" sets both resultEntity and unfilteredResult; pick one.`,
        );
      }
      if (def.unfilteredResult !== undefined) {
        assertReason(`queryHandler "${def.name}" unfilteredResult`, def.unfilteredResult.reason);
      }
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
        ...(def.resultEntity && { resultEntity: def.resultEntity }),
        ...(def.unfilteredResult && { unfilteredResult: def.unfilteredResult }),
        ...(def.escapeHatch && { escapeHatch: def.escapeHatch }),
        // Carry the definePagedQueryHandler brand through — this rebuild
        // drops any field not explicitly listed.
        ...(isPagedQueryHandler(def) && { [PAGED_QUERY_HANDLER_BRAND]: true }),
        ...(isEntityConventionQueryHandler(def) && {
          [ENTITY_CONVENTION_QUERY_BRAND]: true as const,
        }),
      };
      tryMapEntity(state, name, def.name);
      return {
        name: def.name,
        ...queryContract<z.input<TSchema>, Exclude<TResult, WriteFailure>>(
          qualifyQueryName(name, def.name),
        ),
      };
    },
    streamHandler<TName extends string, TSchema extends ZodType>(
      def: StreamHandlerDefinition<TName, TSchema>,
    ): HandlerRef {
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
    },
  };
  return {
    ...methods,
    crud(entity: EntityDefinition, options?: RegisterEntityCrudOptions): void {
      registerCrudHandlers(methods, entity, options);
    },
  };
}
