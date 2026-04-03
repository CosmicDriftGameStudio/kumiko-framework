import type { ZodType, z } from "zod";
import { buildCrudHandlers } from "./crud-builder";
import type { WriteHandlerDefinition, QueryHandlerDefinition } from "./define-handler";
import type {
  AccessRule,
  ConfigDefinition,
  ConfigKeyDefinition,
  EntityDefinition,
  FeatureDefinition,
  FeatureRegistrar,
  HookMap,
  JobDefinition,
  JobHandlerFn,
  LifecycleHookFn,
  LifecycleHookType,
  QueryHandlerDef,
  QueryHandlerFn,
  RegistrarExtensionDef,
  RegistrarExtensionRegistration,
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
  const requires: string[] = [];
  const optionalRequires: string[] = [];
  const entities: Record<string, EntityDefinition> = {};
  const relations: Record<string, Record<string, RelationDefinition>> = {};
  const writeHandlers: Record<string, WriteHandlerDef> = {};
  const queryHandlers: Record<string, QueryHandlerDef> = {};
  const validationHooks: Record<string, ValidationHookFn> = {};
  const lifecycleHooks: Record<string, Record<string, LifecycleHookFn[]>> = {};
  const configKeys: Record<string, ConfigKeyDefinition> = {};
  const jobs: Record<string, JobDefinition> = {};
  const registrarExtensions: Record<string, RegistrarExtensionDef> = {};
  const extensionUsages: RegistrarExtensionRegistration[] = [];
  let translations: TranslationKeys = {};

  for (const t of LIFECYCLE_TYPES) {
    lifecycleHooks[t] = {};
  }

  const registrar: FeatureRegistrar = {
    requires(...featureNames: string[]): void {
      requires.push(...featureNames);
    },

    optionalRequires(...featureNames: string[]): void {
      optionalRequires.push(...featureNames);
    },

    entity(entityName: string, definition: EntityDefinition): void {
      entities[entityName] = definition;
    },

    writeHandler<TSchema extends ZodType>(
      nameOrDef: string | WriteHandlerDefinition<TSchema>,
      schema?: TSchema,
      handler?: WriteHandlerFn<z.infer<TSchema>>,
      options?: { access?: AccessRule },
    ): void {
      if (typeof nameOrDef === "object") {
        // Object form: r.writeHandler(defineWriteHandler({ name, schema, handler }))
        const def = nameOrDef;
        writeHandlers[def.name] = {
          name: def.name,
          schema: def.schema,
          handler: def.handler as WriteHandlerFn,
          ...(def.access && { access: def.access }),
        };
      } else {
        // Inline form: r.writeHandler("name", schema, handler, options)
        writeHandlers[nameOrDef] = {
          name: nameOrDef,
          schema: schema!,
          handler: handler as WriteHandlerFn,
          ...(options?.access && { access: options.access }),
        };
      }
    },

    queryHandler<TSchema extends ZodType>(
      nameOrDef: string | QueryHandlerDefinition<TSchema>,
      schema?: TSchema,
      handler?: QueryHandlerFn<z.infer<TSchema>>,
      options?: { access?: AccessRule },
    ): void {
      if (typeof nameOrDef === "object") {
        // Object form: r.queryHandler(defineQueryHandler({ name, schema, handler }))
        const def = nameOrDef;
        queryHandlers[def.name] = {
          name: def.name,
          schema: def.schema,
          handler: def.handler as QueryHandlerFn,
          ...(def.access && { access: def.access }),
        };
      } else {
        // Inline form: r.queryHandler("name", schema, handler, options)
        queryHandlers[nameOrDef] = {
          name: nameOrDef,
          schema: schema!,
          handler: handler as QueryHandlerFn,
          ...(options?.access && { access: options.access }),
        };
      }
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

    config(definition: ConfigDefinition): void {
      for (const [key, keyDef] of Object.entries(definition.keys)) {
        configKeys[key] = keyDef;
      }
    },

    job(jobName: string, options: Omit<JobDefinition, "name">, handler: JobHandlerFn): void {
      jobs[jobName] = { ...options, name: jobName, handler };
    },

    translations(def: TranslationsDef): void {
      translations = { ...translations, ...def.keys };
    },

    extendsRegistrar(extensionName: string, def: RegistrarExtensionDef): void {
      registrarExtensions[extensionName] = def;
    },
  };

  // Wrap registrar with Proxy so that r.customFields("entity") works dynamically.
  // When a feature calls r.someExtension("entity", options), we record the usage.
  const proxiedRegistrar = new Proxy(registrar, {
    get(target, prop: string) {
      if (prop in target) return target[prop as keyof typeof target];

      // Dynamic extension call: r.extensionName(entityName, options?)
      return (entityName: string, options?: Record<string, unknown>) => {
        extensionUsages.push({ extensionName: prop, entityName, options });
      };
    },
  }) as FeatureRegistrar;

  setup(proxiedRegistrar);

  return {
    name,
    requires,
    optionalRequires,
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
    configKeys,
    jobs,
    registrarExtensions,
    extensionUsages,
  };
}
