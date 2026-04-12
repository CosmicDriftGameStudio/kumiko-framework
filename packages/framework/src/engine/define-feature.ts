import type { ZodType, z } from "zod";
import { LifecycleHookTypes } from "./constants";
import { buildCrudHandlers } from "./crud-builder";
import type { QueryHandlerDefinition, WriteHandlerDefinition } from "./define-handler";
import type {
  AccessRule,
  ConfigDefinition,
  ConfigKeyDefinition,
  EntityDefinition,
  FeatureDefinition,
  FeatureRegistrar,
  HandlerRef,
  HookMap,
  JobDefinition,
  JobHandlerFn,
  LifecycleHookFn,
  LifecycleHookType,
  PostDeleteHookFn,
  PostSaveHookFn,
  PreDeleteHookFn,
  QueryHandlerDef,
  QueryHandlerFn,
  ReferenceDataDef,
  RegistrarExtensionDef,
  RegistrarExtensionRegistration,
  RelationDefinition,
  TranslationKeys,
  TranslationsDef,
  ValidationHookFn,
  WriteHandlerDef,
  WriteHandlerFn,
} from "./types";

const LIFECYCLE_TYPES = Object.values(LifecycleHookTypes);

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
  const events: Record<string, { name: string; schema: ZodType }> = {};
  const configReads: string[] = [];
  const entityPostSave: Record<string, PostSaveHookFn[]> = {};
  const entityPreDelete: Record<string, PreDeleteHookFn[]> = {};
  const entityPostDelete: Record<string, PostDeleteHookFn[]> = {};
  const registrarExtensions: Record<string, RegistrarExtensionDef> = {};
  const extensionUsages: RegistrarExtensionRegistration[] = [];
  const referenceData: ReferenceDataDef[] = [];
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

    writeHandler<TName extends string, TSchema extends ZodType>(
      nameOrDef: string | WriteHandlerDefinition<TName, TSchema>,
      schema?: TSchema,
      handler?: WriteHandlerFn<z.infer<TSchema>>,
      options?: { access?: AccessRule },
    ): HandlerRef {
      if (typeof nameOrDef === "object") {
        const def = nameOrDef;
        writeHandlers[def.name] = {
          name: def.name,
          schema: def.schema,
          handler: def.handler as WriteHandlerFn,
          ...(def.access && { access: def.access }),
        };
        return { name: def.name };
      }
      if (!schema || !handler)
        throw new Error("writeHandler inline form requires schema + handler");
      writeHandlers[nameOrDef] = {
        name: nameOrDef,
        schema,
        handler: handler as WriteHandlerFn,
        ...(options?.access && { access: options.access }),
      };
      return { name: nameOrDef };
    },

    queryHandler<TName extends string, TSchema extends ZodType>(
      nameOrDef: string | QueryHandlerDefinition<TName, TSchema>,
      schema?: TSchema,
      handler?: QueryHandlerFn<z.infer<TSchema>>,
      options?: { access?: AccessRule },
    ): HandlerRef {
      if (typeof nameOrDef === "object") {
        const def = nameOrDef;
        queryHandlers[def.name] = {
          name: def.name,
          schema: def.schema,
          handler: def.handler as QueryHandlerFn,
          ...(def.access && { access: def.access }),
        };
        return { name: def.name };
      }
      if (!schema || !handler)
        throw new Error("queryHandler inline form requires schema + handler");
      queryHandlers[nameOrDef] = {
        name: nameOrDef,
        schema,
        handler: handler as QueryHandlerFn,
        ...(options?.access && { access: options.access }),
      };
      return { name: nameOrDef };
    },

    crud(entityName: string, options?: { access?: AccessRule }) {
      const entity = entities[entityName];
      if (!entity) {
        throw new Error(
          `Entity "${entityName}" not found. Register it with r.entity() before r.crud().`,
        );
      }
      const crud = buildCrudHandlers(entityName, entity, options);
      Object.assign(writeHandlers, crud.writeHandlers);
      Object.assign(queryHandlers, crud.queryHandlers);
      return {
        handlers: {
          create: { name: `${entityName}.create` },
          update: { name: `${entityName}.update` },
          delete: { name: `${entityName}.delete` },
        },
        queries: {
          list: { name: `${entityName}.list` },
          detail: { name: `${entityName}.detail` },
        },
      };
    },

    relation(entityName: string, relationName: string, definition: RelationDefinition): void {
      if (!relations[entityName]) relations[entityName] = {};
      relations[entityName][relationName] = definition;
    },

    hook(
      type: LifecycleHookType | "validation",
      hookName: string | readonly string[],
      fn: LifecycleHookFn | ValidationHookFn,
    ): void {
      const names = Array.isArray(hookName) ? hookName : [hookName];

      if (type === "validation") {
        for (const n of names) {
          validationHooks[n] = fn as ValidationHookFn;
        }
        return;
      }

      const hookType = type;
      if (!lifecycleHooks[hookType]) lifecycleHooks[hookType] = {};
      for (const n of names) {
        if (!lifecycleHooks[hookType][n]) lifecycleHooks[hookType][n] = [];
        lifecycleHooks[hookType][n].push(fn as LifecycleHookFn);
      }
    },

    entityHook(
      type: "postSave" | "preDelete" | "postDelete",
      entityName: string,
      fn: LifecycleHookFn,
    ): void {
      if (type === "postSave") {
        if (!entityPostSave[entityName]) entityPostSave[entityName] = [];
        entityPostSave[entityName].push(fn as PostSaveHookFn);
      } else if (type === "preDelete") {
        if (!entityPreDelete[entityName]) entityPreDelete[entityName] = [];
        entityPreDelete[entityName].push(fn as PreDeleteHookFn);
      } else if (type === "postDelete") {
        if (!entityPostDelete[entityName]) entityPostDelete[entityName] = [];
        entityPostDelete[entityName].push(fn as PostDeleteHookFn);
      }
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

    defineEvent<TPayload>(eventName: string, schema: ZodType<TPayload>) {
      const def = { name: eventName, schema };
      events[eventName] = def;
      return def;
    },

    readsConfig(...qualifiedKeys: string[]): void {
      configReads.push(...qualifiedKeys);
    },

    referenceData(
      entityName: string,
      data: readonly Record<string, unknown>[],
      options?: { upsertKey?: string },
    ): void {
      referenceData.push({ entityName, data, upsertKey: options?.upsertKey });
    },

    extendsRegistrar(extensionName: string, def: RegistrarExtensionDef): void {
      registrarExtensions[extensionName] = def;
    },

    useExtension(
      extensionName: string,
      entityName: string,
      options?: Record<string, unknown>,
    ): void {
      extensionUsages.push({ extensionName, entityName, options });
    },
  };

  setup(registrar);

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
    entityHooks: {
      postSave: entityPostSave,
      preDelete: entityPreDelete,
      postDelete: entityPostDelete,
    },
    configKeys,
    jobs,
    registrarExtensions,
    extensionUsages,
    referenceData,
    events,
    configReads,
  };
}
