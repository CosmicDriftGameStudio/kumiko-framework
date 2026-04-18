import type { ZodType, z } from "zod";
import { toTableName } from "../db/table-builder";
import { LifecycleHookTypes } from "./constants";
import type { QueryHandlerDefinition, WriteHandlerDefinition } from "./define-handler";
import { isKebabSegment, qn, toKebab } from "./qualified-name";
import type {
  AccessRule,
  ConfigKeyDefinition,
  ConfigKeyHandle,
  ConfigKeyType,
  EntityDefinition,
  EntityRef,
  EventMigrationDef,
  EventUpcastFn,
  FeatureDefinition,
  FeatureMetricDef,
  FeatureRegistrar,
  HandlerRef,
  HookMap,
  HookPhase,
  JobDefinition,
  JobHandlerFn,
  LifecycleHookFn,
  LifecycleHookType,
  MetricOptions,
  MultiStreamProjectionDefinition,
  NameOrRef,
  NotificationDataFn,
  NotificationDefinition,
  NotificationRecipientFn,
  NotificationTemplateFn,
  PhasedHook,
  PostDeleteHookFn,
  PostSaveHookFn,
  PreDeleteHookFn,
  ProjectionDefinition,
  QueryHandlerDef,
  QueryHandlerFn,
  RateLimitOption,
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
import { HookPhases } from "./types";
import { resolveName } from "./types/handlers";

const LIFECYCLE_TYPES = Object.values(LifecycleHookTypes);

// `TExports` lets the setup callback hand back a typed object that
// downstream features can import (e.g. `tenantFeature.exports.config`). The
// runtime always packs whatever setup returns into `featureDef.exports` —
// `void` returns become `undefined` and stay invisible at the call site.
export function defineFeature<TExports = undefined>(
  name: string,
  setup: (r: FeatureRegistrar) => TExports,
): FeatureDefinition & { readonly exports: TExports } {
  const requires: string[] = [];
  const optionalRequires: string[] = [];
  const entities: Record<string, EntityDefinition> = {};
  const relations: Record<string, Record<string, RelationDefinition>> = {};
  const writeHandlers: Record<string, WriteHandlerDef> = {};
  const queryHandlers: Record<string, QueryHandlerDef> = {};
  const validationHooks: Record<string, ValidationHookFn> = {};
  // preSave/preQuery stay unphased; postSave/preDelete/postDelete are phased.
  const lifecycleHooks: Record<string, Record<string, LifecycleHookFn[]>> = {};
  const phasedLifecycleHooks: Record<
    "postSave" | "preDelete" | "postDelete",
    Record<string, PhasedHook<LifecycleHookFn>[]>
  > = { postSave: {}, preDelete: {}, postDelete: {} };
  const configKeys: Record<string, ConfigKeyDefinition> = {};
  const jobs: Record<string, JobDefinition> = {};
  const events: Record<string, { name: string; schema: ZodType; version: number }> = {};
  const eventMigrations: Record<string, EventMigrationDef[]> = {};
  const configReads: string[] = [];
  const entityPostSave: Record<string, PhasedHook<PostSaveHookFn>[]> = {};
  const entityPreDelete: Record<string, PhasedHook<PreDeleteHookFn>[]> = {};
  const entityPostDelete: Record<string, PhasedHook<PostDeleteHookFn>[]> = {};
  const notifications: Record<string, NotificationDefinition> = {};
  const registrarExtensions: Record<string, RegistrarExtensionDef> = {};
  const extensionUsages: RegistrarExtensionRegistration[] = [];
  const referenceData: ReferenceDataDef[] = [];
  const handlerEntityMappings: Record<string, string> = {};
  const metrics: Record<string, FeatureMetricDef> = {};
  const projections: Record<string, ProjectionDefinition> = {};
  const multiStreamProjections: Record<string, MultiStreamProjectionDefinition> = {};
  let translations: TranslationKeys = {};

  for (const t of LIFECYCLE_TYPES) {
    lifecycleHooks[t] = {};
  }

  let isSystemScoped = false;

  // Map handler name to entity via colon convention.
  // "task:create" → entity "task". No colon → standalone handler, no mapping.
  function tryMapEntity(handlerName: string): void {
    const colonIdx = handlerName.indexOf(":");
    // skip: handler name is not entity-scoped (no colon), nothing to map
    if (colonIdx < 0) return;
    const candidate = handlerName.slice(0, colonIdx);
    if (entities[candidate]) {
      handlerEntityMappings[handlerName] = candidate;
    }
  }

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
      options?: { access?: AccessRule; rateLimit?: RateLimitOption },
    ): HandlerRef {
      if (typeof nameOrDef === "object") {
        const def = nameOrDef;
        writeHandlers[def.name] = {
          name: def.name,
          schema: def.schema,
          handler: def.handler as WriteHandlerFn,
          ...(def.access && { access: def.access }),
          ...(def.skipTransitionGuard && { skipTransitionGuard: true }),
          ...(def.rateLimit && { rateLimit: def.rateLimit }),
        };
        tryMapEntity(def.name);
        return { name: def.name };
      }
      if (!schema || !handler)
        throw new Error("writeHandler inline form requires schema + handler");
      writeHandlers[nameOrDef] = {
        name: nameOrDef,
        schema,
        handler: handler as WriteHandlerFn,
        ...(options?.access && { access: options.access }),
        ...(options?.rateLimit && { rateLimit: options.rateLimit }),
      };
      tryMapEntity(nameOrDef);
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
        queryHandlers[def.name] = {
          name: def.name,
          schema: def.schema,
          handler: def.handler as QueryHandlerFn,
          ...(def.access && { access: def.access }),
          ...(def.rateLimit && { rateLimit: def.rateLimit }),
        };
        tryMapEntity(def.name);
        return { name: def.name };
      }
      if (!schema || !handler)
        throw new Error("queryHandler inline form requires schema + handler");
      queryHandlers[nameOrDef] = {
        name: nameOrDef,
        schema,
        handler: handler as QueryHandlerFn,
        ...(options?.access && { access: options.access }),
        ...(options?.rateLimit && { rateLimit: options.rateLimit }),
      };
      tryMapEntity(nameOrDef);
      return { name: nameOrDef };
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
      options?: { phase?: HookPhase },
    ): void {
      const targets = Array.isArray(target) ? target : [target];
      const names = targets.map(resolveName);

      if (type === "validation") {
        for (const n of names) {
          validationHooks[n] = fn as ValidationHookFn;
        }
        // skip: validation hooks have no phase, stored and done
        return;
      }

      if (type === LifecycleHookTypes.preSave || type === LifecycleHookTypes.preQuery) {
        if (!lifecycleHooks[type]) lifecycleHooks[type] = {};
        for (const n of names) {
          if (!lifecycleHooks[type][n]) lifecycleHooks[type][n] = [];
          lifecycleHooks[type][n].push(fn as LifecycleHookFn);
        }
        // skip: pre-hooks have no phase, stored and done
        return;
      }

      // Phased storage. preDelete has no phase option (always inTransaction);
      // postSave/postDelete default to afterCommit.
      const phase =
        type === LifecycleHookTypes.preDelete
          ? HookPhases.inTransaction
          : (options?.phase ?? HookPhases.afterCommit);
      const bucket = phasedLifecycleHooks[type];
      for (const n of names) {
        if (!bucket[n]) bucket[n] = [];
        bucket[n].push({ fn: fn as LifecycleHookFn, phase });
      }
    },

    entityHook(
      type: "postSave" | "preDelete" | "postDelete",
      entityRef: NameOrRef,
      fn: LifecycleHookFn,
      options?: { phase?: HookPhase },
    ): void {
      const entityName = resolveName(entityRef);
      if (type === LifecycleHookTypes.postSave) {
        const phase = options?.phase ?? HookPhases.afterCommit;
        if (!entityPostSave[entityName]) entityPostSave[entityName] = [];
        entityPostSave[entityName].push({ fn: fn as PostSaveHookFn, phase });
      } else if (type === LifecycleHookTypes.preDelete) {
        if (!entityPreDelete[entityName]) entityPreDelete[entityName] = [];
        entityPreDelete[entityName].push({
          fn: fn as PreDeleteHookFn,
          phase: HookPhases.inTransaction,
        });
      } else if (type === LifecycleHookTypes.postDelete) {
        const phase = options?.phase ?? HookPhases.afterCommit;
        if (!entityPostDelete[entityName]) entityPostDelete[entityName] = [];
        entityPostDelete[entityName].push({ fn: fn as PostDeleteHookFn, phase });
      }
    },

    config<TKeys extends Readonly<Record<string, ConfigKeyDefinition<ConfigKeyType>>>>(definition: {
      readonly keys: TKeys;
    }): { readonly [K in keyof TKeys]: ConfigKeyHandle<TKeys[K]["type"]> } {
      // Qualify eagerly (same as defineEvent) so the handle name matches what
      // the registry stores — lazy qualification would break compile-time
      // autocomplete and hand-built test registries.
      const handles: Record<string, ConfigKeyHandle<ConfigKeyType>> = {};
      for (const [key, keyDef] of Object.entries(definition.keys)) {
        configKeys[key] = keyDef;
        handles[key] = {
          name: qn(toKebab(name), "config", toKebab(key)),
          type: keyDef.type,
        };
      }
      return handles as { readonly [K in keyof TKeys]: ConfigKeyHandle<TKeys[K]["type"]> };
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
        readonly templates?: Readonly<Record<string, NotificationTemplateFn>>;
      },
    ): void {
      notifications[notificationName] = {
        name: notificationName,
        trigger: { on: resolveName(definition.trigger.on) },
        recipient: definition.recipient,
        data: definition.data,
        templates: definition.templates,
      };
    },

    translations(def: TranslationsDef): void {
      translations = { ...translations, ...def.keys };
    },

    defineEvent<TPayload>(
      eventName: string,
      schema: ZodType<TPayload>,
      options?: { readonly version?: number },
    ) {
      // Return the fully-qualified event name so callers can pass it
      // straight to ctx.appendEvent without hand-building the
      // "<feature>:event:<name>" shape. Registry keeps events keyed by
      // short name — qualification is the framework's job, not the feature
      // author's.
      const qualified = qn(toKebab(name), "event", toKebab(eventName));
      const version = options?.version ?? 1;
      if (!Number.isInteger(version) || version < 1) {
        throw new Error(
          `[Feature ${name}] defineEvent("${eventName}"): version must be a positive integer, got ${String(version)}`,
        );
      }
      const def = { name: qualified, schema, version };
      events[eventName] = def;
      return def;
    },

    eventMigration(
      eventName: string,
      fromVersion: number,
      toVersion: number,
      transform: EventUpcastFn,
    ): void {
      if (toVersion !== fromVersion + 1) {
        throw new Error(
          `[Feature ${name}] eventMigration("${eventName}", ${fromVersion}, ${toVersion}): ` +
            `only single-step migrations are allowed — toVersion must be fromVersion + 1. ` +
            `Chain larger jumps by registering each step separately.`,
        );
      }
      if (!Number.isInteger(fromVersion) || fromVersion < 1) {
        throw new Error(
          `[Feature ${name}] eventMigration("${eventName}", ...): fromVersion must be >= 1, got ${String(fromVersion)}`,
        );
      }
      const qualified = qn(toKebab(name), "event", toKebab(eventName));
      const list = eventMigrations[eventName] ?? [];
      if (list.some((m) => m.fromVersion === fromVersion)) {
        throw new Error(
          `[Feature ${name}] eventMigration("${eventName}", ${fromVersion}, ${toVersion}): ` +
            `a migration from v${fromVersion} is already registered. Each step may only be declared once.`,
        );
      }
      list.push({ eventName: qualified, fromVersion, toVersion, transform });
      eventMigrations[eventName] = list;
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

    metric(shortName: string, options: MetricOptions): void {
      if (metrics[shortName]) {
        throw new Error(
          `[Feature ${name}] Metric "${shortName}" already registered. ` +
            `Metric names must be unique per feature.`,
        );
      }
      metrics[shortName] = { shortName, ...options };
    },

    projection(definition: ProjectionDefinition): void {
      // Reject names that would blow up at registry-boot when we qualify them.
      // Catch it at the registration site so the stack trace points at the
      // feature file, not at framework internals.
      if (!isKebabSegment(definition.name)) {
        throw new Error(
          `[Feature ${name}] Projection name "${definition.name}" must be kebab-case ` +
            `(lowercase letters, digits, dashes; start with a letter). ` +
            `Got "${definition.name}" — try "${toKebab(definition.name).replace(/_/g, "-")}".`,
        );
      }
      if (projections[definition.name]) {
        throw new Error(
          `[Feature ${name}] Projection "${definition.name}" already registered. ` +
            `Projection names must be unique per feature.`,
        );
      }
      projections[definition.name] = definition;
    },

    multiStreamProjection(definition: MultiStreamProjectionDefinition): void {
      if (!isKebabSegment(definition.name)) {
        throw new Error(
          `[Feature ${name}] MultiStreamProjection name "${definition.name}" must be kebab-case ` +
            `(lowercase letters, digits, dashes; start with a letter). ` +
            `Got "${definition.name}" — try "${toKebab(definition.name).replace(/_/g, "-")}".`,
        );
      }
      if (multiStreamProjections[definition.name] || projections[definition.name]) {
        throw new Error(
          `[Feature ${name}] Projection name "${definition.name}" already registered. ` +
            `r.projection and r.multiStreamProjection share a namespace — pick a unique short name.`,
        );
      }
      if (Object.keys(definition.apply).length === 0) {
        throw new Error(
          `[Feature ${name}] MultiStreamProjection "${definition.name}" has no apply handlers. ` +
            `Declare at least one event type it reacts to, otherwise the dispatcher has nothing to route.`,
        );
      }
      multiStreamProjections[definition.name] = definition;
    },
  };

  const exports = setup(registrar) as TExports;

  return {
    name,
    systemScope: isSystemScoped,
    exports,
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
      postSave: phasedLifecycleHooks.postSave,
      preDelete: phasedLifecycleHooks.preDelete,
      postDelete: phasedLifecycleHooks.postDelete,
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
    eventMigrations,
    configReads,
    handlerEntityMappings,
    metrics,
    projections,
    multiStreamProjections,
  };
}
