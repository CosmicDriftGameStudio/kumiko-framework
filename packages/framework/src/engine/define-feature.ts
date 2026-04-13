import type { ZodType, z } from "zod";
import { toTableName } from "../db/table-builder";
import { LifecycleHookTypes } from "./constants";
import { buildCrudHandlers } from "./crud-builder";
import type { QueryHandlerDefinition, WriteHandlerDefinition } from "./define-handler";
import type {
  AccessRule,
  ConfigDefinition,
  ConfigKeyDefinition,
  EntityDefinition,
  EntityRef,
  FeatureDefinition,
  FeatureRegistrar,
  HandlerRef,
  HookMap,
  JobDefinition,
  JobHandlerFn,
  LifecycleHookFn,
  NotificationDataFn,
  NotificationDefinition,
  NotificationRecipientFn,
  LifecycleHookType,
  NameOrRef,
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
import { resolveName } from "./types/handlers";

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
  const notifications: Record<string, NotificationDefinition> = {};
  const registrarExtensions: Record<string, RegistrarExtensionDef> = {};
  const extensionUsages: RegistrarExtensionRegistration[] = [];
  const referenceData: ReferenceDataDef[] = [];
  let translations: TranslationKeys = {};

  for (const t of LIFECYCLE_TYPES) {
    lifecycleHooks[t] = {};
  }

  let isSystemScoped = false;

  const registrar: FeatureRegistrar = {
    systemScope(): void {
      isSystemScoped = true;
    },

    requires(...featureNames: string[]): void {
      requires.push(...featureNames);
    },

    optionalRequires(...featureNames: string[]): void {
      optionalRequires.push(...featureNames);
    },

    entity(entityName: string, definition: EntityDefinition): EntityRef {
      entities[entityName] = definition;
      return { name: entityName, table: definition.table ?? toTableName(entityName) };
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
          ...(def.skipTransitionGuard && { skipTransitionGuard: true }),
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

    crud(entityRef: NameOrRef, options?: { access?: AccessRule }) {
      const entityName = resolveName(entityRef);
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
        entity: { name: entityName, table: entity.table ?? toTableName(entityName) },
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

    relation(entityRef: NameOrRef, relationName: string, definition: RelationDefinition): void {
      const entityName = resolveName(entityRef);
      if (!relations[entityName]) relations[entityName] = {};
      relations[entityName][relationName] = definition;
    },

    hook(
      type: LifecycleHookType | "validation",
      target: NameOrRef | readonly NameOrRef[],
      fn: LifecycleHookFn | ValidationHookFn,
    ): void {
      const targets = Array.isArray(target) ? target : [target];
      const names = targets.map(resolveName);

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
      entityRef: NameOrRef,
      fn: LifecycleHookFn,
    ): void {
      const entityName = resolveName(entityRef);
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

    job(
      jobName: string,
      options: Omit<JobDefinition, "name" | "handler">,
      handler: JobHandlerFn,
    ): void {
      // Resolve NameOrRef in trigger.on to string for storage
      const trigger =
        "on" in options.trigger ? { on: resolveName(options.trigger.on) } : options.trigger;
      jobs[jobName] = { ...options, trigger, name: jobName, handler };
    },

    notification(
      notificationName: string,
      definition: {
        readonly trigger: { readonly on: NameOrRef };
        readonly recipient: NotificationRecipientFn;
        readonly data: NotificationDataFn;
        readonly channels?: readonly string[];
      },
    ): void {
      notifications[notificationName] = {
        name: notificationName,
        trigger: { on: resolveName(definition.trigger.on) },
        recipient: definition.recipient,
        data: definition.data,
        channels: definition.channels,
      };
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
      entityRef: NameOrRef,
      data: readonly Record<string, unknown>[],
      options?: { upsertKey?: string },
    ): void {
      referenceData.push({
        entityName: resolveName(entityRef),
        data,
        upsertKey: options?.upsertKey,
      });
    },

    extendsRegistrar(extensionName: string, def: RegistrarExtensionDef): void {
      registrarExtensions[extensionName] = def;
    },

    useExtension(
      extensionName: string,
      entityRef: NameOrRef,
      options?: Record<string, unknown>,
    ): void {
      extensionUsages.push({ extensionName, entityName: resolveName(entityRef), options });
    },
  };

  setup(registrar);

  return {
    name,
    systemScope: isSystemScoped,
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
    notifications,
    registrarExtensions,
    extensionUsages,
    referenceData,
    events,
    configReads,
  };
}
