import type { ZodType, z } from "zod";
import { buildCrudHandlers } from "./crud-builder";
import type {
  AccessRule,
  EntityDefinition,
  FeatureDefinition,
  FeatureRegistrar,
  HookMap,
  LifecycleHookFn,
  LifecycleHookType,
  QueryHandlerDef,
  QueryHandlerFn,
  RelationDefinition,
  TranslationKeys,
  TranslationsDef,
  ValidationHookFn,
  WriteHandlerDef,
  WriteHandlerFn,
} from "./types";

const LIFECYCLE_TYPES: readonly LifecycleHookType[] = [
  "preSave",
  "postSave",
  "preDelete",
  "postDelete",
  "preQuery",
];

export function defineFeature(
  name: string,
  setup: (r: FeatureRegistrar) => void,
): FeatureDefinition {
  const entities: Record<string, EntityDefinition> = {};
  const relations: Record<string, Record<string, RelationDefinition>> = {};
  const writeHandlers: Record<string, WriteHandlerDef> = {};
  const queryHandlers: Record<string, QueryHandlerDef> = {};
  const validationHooks: Record<string, ValidationHookFn> = {};
  const lifecycleHooks: Record<string, Record<string, LifecycleHookFn[]>> = {};
  let translations: TranslationKeys = {};

  for (const t of LIFECYCLE_TYPES) {
    lifecycleHooks[t] = {};
  }

  const registrar: FeatureRegistrar = {
    entity(entityName: string, definition: EntityDefinition): void {
      entities[entityName] = definition;
    },

    writeHandler<TSchema extends ZodType>(
      handlerName: string,
      schema: TSchema,
      handler: WriteHandlerFn<z.infer<TSchema>>,
      options?: { access?: AccessRule },
    ): void {
      writeHandlers[handlerName] = {
        name: handlerName,
        schema,
        handler: handler as WriteHandlerFn,
        ...(options?.access && { access: options.access }),
      };
    },

    queryHandler<TSchema extends ZodType>(
      handlerName: string,
      schema: TSchema,
      handler: QueryHandlerFn<z.infer<TSchema>>,
      options?: { access?: AccessRule },
    ): void {
      queryHandlers[handlerName] = {
        name: handlerName,
        schema,
        handler: handler as QueryHandlerFn,
        ...(options?.access && { access: options.access }),
      };
    },

    crud(entityName: string, options?: { access?: AccessRule }): void {
      const entity = entities[entityName];
      if (!entity) {
        throw new Error(
          `Entity "${entityName}" not found. Register it with r.entity() before r.crud().`,
        );
      }
      const crud = buildCrudHandlers(entityName, entity, options);
      Object.assign(writeHandlers, crud.writeHandlers);
      Object.assign(queryHandlers, crud.queryHandlers);
    },

    relation(entityName: string, relationName: string, definition: RelationDefinition): void {
      if (!relations[entityName]) relations[entityName] = {};
      relations[entityName][relationName] = definition;
    },

    hook(type: string, hookName: string, fn: LifecycleHookFn | ValidationHookFn): void {
      if (type === "validation") {
        validationHooks[hookName] = fn as ValidationHookFn;
        return;
      }

      const hookType = type as LifecycleHookType;
      if (!lifecycleHooks[hookType]) lifecycleHooks[hookType] = {};
      if (!lifecycleHooks[hookType][hookName]) lifecycleHooks[hookType][hookName] = [];
      lifecycleHooks[hookType][hookName].push(fn as LifecycleHookFn);
    },

    translations(def: TranslationsDef): void {
      translations = { ...translations, ...def.keys };
    },
  };

  setup(registrar);

  return {
    name,
    entities,
    relations,
    writeHandlers,
    queryHandlers,
    translations,
    hooks: {
      validation: validationHooks,
      preSave: lifecycleHooks["preSave"] ?? {},
      postSave: lifecycleHooks["postSave"] ?? {},
      preDelete: lifecycleHooks["preDelete"] ?? {},
      postDelete: lifecycleHooks["postDelete"] ?? {},
      preQuery: lifecycleHooks["preQuery"] ?? {},
    } as HookMap,
  };
}
