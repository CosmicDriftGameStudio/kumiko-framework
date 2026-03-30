import type { ZodType, z } from "zod";
import { buildCrudHandlers } from "./crud-builder";
import type {
  AccessRule,
  EntityDefinition,
  FeatureDefinition,
  FeatureRegistrar,
  QueryHandlerDef,
  QueryHandlerFn,
  TranslationKeys,
  TranslationsDef,
  WriteHandlerDef,
  WriteHandlerFn,
} from "./types";

export function defineFeature(
  name: string,
  setup: (r: FeatureRegistrar) => void,
): FeatureDefinition {
  const entities: Record<string, EntityDefinition> = {};
  const writeHandlers: Record<string, WriteHandlerDef> = {};
  const queryHandlers: Record<string, QueryHandlerDef> = {};
  let translations: TranslationKeys = {};

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

    translations(def: TranslationsDef): void {
      translations = { ...translations, ...def.keys };
    },
  };

  setup(registrar);

  return {
    name,
    entities,
    writeHandlers,
    queryHandlers,
    translations,
  };
}
