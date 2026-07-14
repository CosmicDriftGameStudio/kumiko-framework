import { ZodObject, type ZodType, type z } from "zod";
import type { EntityTableMeta } from "../db/entity-table-meta";
import { toTableName } from "../db/table-builder";
import { LifecycleHookTypes } from "./constants";
import type { QueryHandlerDefinition, WriteHandlerDefinition } from "./define-handler";
import { type RegisterEntityCrudOptions, registerEntityCrud } from "./entity-handlers";
import { isKebabSegment, QnTypes, qn, toKebab } from "./qualified-name";
import type {
  AccessRule,
  AuthClaimsFn,
  ClaimKeyDefinition,
  ClaimKeyHandle,
  ClaimKeyType,
  ConfigKeyDefinition,
  ConfigKeyHandle,
  ConfigKeyType,
  ConfigSeedDef,
  DeclarativeEventMigration,
  EntityDefinition,
  EntityProjectionExtension,
  EntityRef,
  EventDef,
  EventMigrationDef,
  EventPiiFields,
  EventUpcastFn,
  ExtensionSelectorDef,
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
  OwnedFn,
  PhasedHook,
  PostDeleteHookFn,
  PostQueryHookFn,
  PostSaveHookFn,
  PreDeleteHookFn,
  ProjectionDefinition,
  QualifiedEventName,
  QueryHandlerDef,
  QueryHandlerFn,
  RateLimitOption,
  RawTableEntry,
  RawTableOptions,
  ReferenceDataDef,
  RegistrarExtensionDef,
  RegistrarExtensionRegistration,
  RelationDefinition,
  SearchPayloadContributorFn,
  SecretKeyDefinition,
  SecretKeyHandle,
  SecretOptions,
  TranslationKeys,
  TranslationsDef,
  TreeActionDef,
  TreeActionsHandle,
  UiHints,
  UnmanagedTableEntry,
  UnmanagedTableOptions,
  ValidationHookFn,
  WriteHandlerDef,
  WriteHandlerFn,
} from "./types";
import { HookPhases } from "./types";
import type { RequiresApi } from "./types/feature";
import { resolveName } from "./types/handlers";
import type { HttpRouteDefinition } from "./types/http-route";
import type { NavDefinition } from "./types/nav";
import type { ScreenDefinition } from "./types/screen";
import type { PipelineDef } from "./types/step";
import type { WorkspaceDefinition } from "./types/workspace";

const LIFECYCLE_TYPES = Object.values(LifecycleHookTypes);

// `TExports` lets the setup callback hand back a typed object that
// downstream features can import (e.g. `tenantFeature.exports.config`). The
// runtime always packs whatever setup returns into `featureDef.exports` —
// `void` returns become `undefined` and stay invisible at the call site.
//
// `TName` (with `const` inference) captures the literal feature-name from
// the call-site (`defineFeature("driverOrders", ...)` → TName="driverOrders").
// The literal threads into the FeatureRegistrar so r.defineEvent's return
// carries `name: "driver-orders:event:foo"` as a literal — strict-mode
// for `ctx.appendEvent({ type: eventDef.name, ... })` lights up. Apps
// that don't care can keep the default-string and use the wrapper-based
// strict-mode (string-literal types per call-site) like before.

// Bundles every Record/Set/array/scalar defineFeature populates while the
// registrar's ~40 methods run — hoisted out of defineFeature's closure so a
// future move-diff (extracting each method into its own module) can thread
// it explicitly. Every field is held BY REFERENCE — no destructured copies.
type FeatureBuilderState = {
  requires: string[];
  optionalRequires: string[];
  requiredProjections: Set<string>;
  requiredSteps: Set<string>;
  entities: Record<string, EntityDefinition>;
  entityTables: Record<string, unknown>;
  relations: Record<string, Record<string, RelationDefinition>>;
  writeHandlers: Record<string, WriteHandlerDef>;
  queryHandlers: Record<string, QueryHandlerDef>;
  validationHooks: Record<string, ValidationHookFn>;
  lifecycleHooks: Record<string, Record<string, OwnedFn<LifecycleHookFn>[]>>;
  phasedLifecycleHooks: Record<
    "postSave" | "preDelete" | "postDelete",
    Record<string, PhasedHook<LifecycleHookFn>[]>
  >;
  configKeys: Record<string, ConfigKeyDefinition>;
  configSeeds: ConfigSeedDef[];
  jobs: Record<string, JobDefinition>;
  events: Record<string, { name: string; schema: ZodType; version: number }>;
  eventMigrations: Record<string, EventMigrationDef[]>;
  configReads: string[];
  entityPostSave: Record<string, PhasedHook<PostSaveHookFn>[]>;
  entityPreDelete: Record<string, PhasedHook<PreDeleteHookFn>[]>;
  entityPostDelete: Record<string, PhasedHook<PostDeleteHookFn>[]>;
  entityPostQuery: Record<string, OwnedFn<PostQueryHookFn>[]>;
  searchPayloadExtensions: Record<string, OwnedFn<SearchPayloadContributorFn>[]>;
  notifications: Record<string, NotificationDefinition>;
  registrarExtensions: Record<string, RegistrarExtensionDef>;
  extensionUsages: RegistrarExtensionRegistration[];
  extensionSelectors: ExtensionSelectorDef[];
  exposedApis: Set<string>;
  usedApis: Set<string>;
  referenceData: ReferenceDataDef[];
  handlerEntityMappings: Record<string, string>;
  metrics: Record<string, FeatureMetricDef>;
  secretKeys: Record<string, SecretKeyDefinition>;
  projections: Record<string, ProjectionDefinition>;
  multiStreamProjections: Record<string, MultiStreamProjectionDefinition>;
  entityProjectionExtensions: Record<string, EntityProjectionExtension[]>;
  rawTables: Record<string, RawTableEntry>;
  unmanagedTables: Record<string, UnmanagedTableEntry>;
  authClaimsHooks: AuthClaimsFn[];
  claimKeys: Record<string, ClaimKeyDefinition>;
  screens: Record<string, ScreenDefinition>;
  navs: Record<string, NavDefinition>;
  workspaces: Record<string, WorkspaceDefinition>;
  httpRoutes: Record<string, HttpRouteDefinition>;
  translations: TranslationKeys;
  isSystemScoped: boolean;
  toggleableDefault: boolean | undefined;
  description: string | undefined;
  uiHints: UiHints | undefined;
  treeActions: Readonly<Record<string, TreeActionDef>> | undefined;
  envSchema: z.ZodObject<z.ZodRawShape> | undefined;
};

function createInitialFeatureBuilderState(): FeatureBuilderState {
  const lifecycleHooks: Record<string, Record<string, OwnedFn<LifecycleHookFn>[]>> = {};
  for (const t of LIFECYCLE_TYPES) {
    lifecycleHooks[t] = {};
  }
  return {
    requires: [],
    optionalRequires: [],
    requiredProjections: new Set<string>(),
    requiredSteps: new Set<string>(),
    entities: {},
    entityTables: {},
    relations: {},
    writeHandlers: {},
    queryHandlers: {},
    validationHooks: {},
    lifecycleHooks,
    phasedLifecycleHooks: { postSave: {}, preDelete: {}, postDelete: {} },
    configKeys: {},
    configSeeds: [],
    jobs: {},
    events: {},
    eventMigrations: {},
    configReads: [],
    entityPostSave: {},
    entityPreDelete: {},
    entityPostDelete: {},
    entityPostQuery: {},
    searchPayloadExtensions: {},
    notifications: {},
    registrarExtensions: {},
    extensionUsages: [],
    extensionSelectors: [],
    exposedApis: new Set(),
    usedApis: new Set(),
    referenceData: [],
    handlerEntityMappings: {},
    metrics: {},
    secretKeys: {},
    projections: {},
    multiStreamProjections: {},
    entityProjectionExtensions: {},
    rawTables: {},
    unmanagedTables: {},
    authClaimsHooks: [],
    claimKeys: {},
    screens: {},
    navs: {},
    workspaces: {},
    httpRoutes: {},
    translations: {},
    isSystemScoped: false,
    toggleableDefault: undefined,
    description: undefined,
    uiHints: undefined,
    treeActions: undefined,
    envSchema: undefined,
  };
}

export function defineFeature<const TName extends string, TExports = undefined>(
  name: TName,
  setup: (r: FeatureRegistrar<TName>) => TExports,
): FeatureDefinition & { readonly exports: TExports } {
  const state = createInitialFeatureBuilderState();

  // Map handler name to entity via colon convention.
  // "task:create" → entity "task". Bare CRUD verbs (create/update/delete) map
  // when feature name matches an entity or the feature owns exactly one entity.
  const CRUD_VERBS = new Set(["create", "update", "delete"]);

  function tryMapEntity(handlerName: string): void {
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

  const registrar: FeatureRegistrar<TName> = {
    systemScope(): void {
      state.isSystemScoped = true;
    },

    describe(text: string): void {
      if (state.description !== undefined) {
        throw new Error(
          `[Feature ${name}] r.describe() called twice — a feature's state.description is declared once`,
        );
      }
      if (typeof text !== "string" || text.trim().length === 0) {
        throw new Error(`[Feature ${name}] r.describe(): text must be a non-empty string`);
      }
      state.description = text.trim();
    },

    requires: (() => {
      const fn = (...featureNames: string[]) => {
        state.requires.push(...featureNames);
      };
      fn.projection = (tableName: string) => {
        state.requiredProjections.add(tableName);
      };
      fn.step = (stepKind: string) => {
        state.requiredSteps.add(stepKind);
      };
      return fn as RequiresApi;
    })(),

    optionalRequires(...featureNames: string[]): void {
      state.optionalRequires.push(...featureNames);
    },

    toggleable(options: { default: boolean }): void {
      if (state.toggleableDefault !== undefined) {
        throw new Error(
          `[Feature ${name}] r.toggleable() called twice — a feature's toggleable status is declared once`,
        );
      }
      state.toggleableDefault = options.default;
    },

    uiHints(hints: UiHints): void {
      if (state.uiHints !== undefined) {
        throw new Error(`[Feature ${name}] r.uiHints() called twice — UI hints are declared once`);
      }
      state.uiHints = hints;
    },

    entity(
      entityName: string,
      definition: EntityDefinition,
      options?: { readonly table?: unknown },
    ): EntityRef {
      state.entities[entityName] = definition;
      if (options?.table !== undefined) state.entityTables[entityName] = options.table;
      return { name: entityName, table: definition.table ?? toTableName(entityName) };
    },

    crud(
      entityName: string,
      definition: EntityDefinition,
      options?: RegisterEntityCrudOptions,
    ): EntityRef {
      registerEntityCrud(registrar, entityName, definition, options);
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
        tryMapEntity(def.name);
        return { name: def.name };
      }
      if (!schema || !handler)
        throw new Error("writeHandler inline form state.requires schema + handler");
      state.writeHandlers[nameOrDef] = {
        name: nameOrDef,
        schema,
        handler: handler as WriteHandlerFn, // @cast-boundary engine-bridge
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
        state.queryHandlers[def.name] = {
          name: def.name,
          schema: def.schema,
          // @cast-boundary engine-bridge — typed Dev-API → erased internal storage
          handler: def.handler as QueryHandlerFn, // @cast-boundary engine-bridge
          ...(def.access && { access: def.access }),
          ...(def.rateLimit && { rateLimit: def.rateLimit }),
        };
        tryMapEntity(def.name);
        return { name: def.name };
      }
      if (!schema || !handler)
        throw new Error("queryHandler inline form state.requires schema + handler");
      state.queryHandlers[nameOrDef] = {
        name: nameOrDef,
        schema,
        handler: handler as QueryHandlerFn, // @cast-boundary engine-bridge
        ...(options?.access && { access: options.access }),
        ...(options?.rateLimit && { rateLimit: options.rateLimit }),
      };
      tryMapEntity(nameOrDef);
      return { name: nameOrDef };
    },

    relation(entityRef: NameOrRef, relationName: string, definition: RelationDefinition): void {
      const entityName = resolveName(entityRef);
      if (!state.relations[entityName]) state.relations[entityName] = {};
      state.relations[entityName][relationName] = definition;
    },

    hook(
      type: LifecycleHookType | "validation",
      target: NameOrRef | readonly NameOrRef[],
      fn: LifecycleHookFn | ValidationHookFn,
      options?: { phase?: HookPhase },
    ): void {
      const targets = Array.isArray(target) ? target : [target];
      const names = targets.map(resolveName);

      // Hook-fn casts unten alle: @cast-boundary engine-bridge
      // — typed Dev-API (LifecycleHookFn|ValidationHookFn) → erased Map<name, fn>.
      if (type === "validation") {
        for (const n of names) {
          state.validationHooks[n] = fn as ValidationHookFn; // @cast-boundary engine-bridge
        }
        // skip: validation hooks have no phase, stored and done
        return;
      }

      if (
        type === LifecycleHookTypes.preSave ||
        type === LifecycleHookTypes.preQuery ||
        type === LifecycleHookTypes.postQuery
      ) {
        if (!state.lifecycleHooks[type]) state.lifecycleHooks[type] = {};
        for (const n of names) {
          if (!state.lifecycleHooks[type][n]) state.lifecycleHooks[type][n] = [];
          state.lifecycleHooks[type][n].push({ fn: fn as LifecycleHookFn, featureName: name }); // @cast-boundary engine-bridge
        }
        // skip: pre/post-hooks without phase semantics, stored and done
        return;
      }

      // Phased storage. preDelete has no phase option (always inTransaction);
      // postSave/postDelete default to afterCommit.
      const phase =
        type === LifecycleHookTypes.preDelete
          ? HookPhases.inTransaction
          : (options?.phase ?? HookPhases.afterCommit);
      const bucket = state.phasedLifecycleHooks[type];
      for (const n of names) {
        if (!bucket[n]) bucket[n] = [];
        bucket[n].push({ fn: fn as LifecycleHookFn, phase, featureName: name }); // @cast-boundary engine-bridge
      }
    },

    entityHook(
      type: "postSave" | "preDelete" | "postDelete" | "postQuery",
      entityRef: NameOrRef,
      fn: LifecycleHookFn,
      options?: { phase?: HookPhase },
    ): void {
      const entityName = resolveName(entityRef);
      if (type === LifecycleHookTypes.postSave) {
        const phase = options?.phase ?? HookPhases.afterCommit;
        if (!state.entityPostSave[entityName]) state.entityPostSave[entityName] = [];
        state.entityPostSave[entityName].push({
          fn: fn as PostSaveHookFn,
          phase,
          featureName: name,
        }); // @cast-boundary engine-bridge
      } else if (type === LifecycleHookTypes.preDelete) {
        if (!state.entityPreDelete[entityName]) state.entityPreDelete[entityName] = [];
        state.entityPreDelete[entityName].push({
          fn: fn as PreDeleteHookFn, // @cast-boundary engine-bridge
          phase: HookPhases.inTransaction,
          featureName: name,
        });
      } else if (type === LifecycleHookTypes.postDelete) {
        const phase = options?.phase ?? HookPhases.afterCommit;
        if (!state.entityPostDelete[entityName]) state.entityPostDelete[entityName] = [];
        state.entityPostDelete[entityName].push({
          fn: fn as PostDeleteHookFn,
          phase,
          featureName: name,
        }); // @cast-boundary engine-bridge
      } else if (type === LifecycleHookTypes.postQuery) {
        // postQuery is unphased (no inTransaction/afterCommit semantics — fires
        // synchronously after query-handler-execute, before field-access-filter)
        if (!state.entityPostQuery[entityName]) state.entityPostQuery[entityName] = [];
        state.entityPostQuery[entityName].push({ fn: fn as PostQueryHookFn, featureName: name }); // @cast-boundary engine-bridge
      }
    },

    searchPayloadExtension(entityRef: NameOrRef, fn: SearchPayloadContributorFn): void {
      const entityName = resolveName(entityRef);
      if (!state.searchPayloadExtensions[entityName])
        state.searchPayloadExtensions[entityName] = [];
      state.searchPayloadExtensions[entityName].push({ fn, featureName: name });
    },

    config<TKeys extends Readonly<Record<string, ConfigKeyDefinition<ConfigKeyType>>>>(definition: {
      readonly keys: TKeys;
      readonly seeds?: Readonly<Record<string, ConfigSeedDef>>;
    }): { readonly [K in keyof TKeys]: ConfigKeyHandle<TKeys[K]["type"]> } {
      // Qualify eagerly (same as defineEvent) so the handle name matches what
      // the registry stores — lazy qualification would break compile-time
      // autocomplete and hand-built test registries.
      const handles: Record<string, ConfigKeyHandle<ConfigKeyType>> = {};
      for (const [key, keyDef] of Object.entries(definition.keys)) {
        state.configKeys[key] = keyDef;
        handles[key] = {
          name: qn(toKebab(name), "config", toKebab(key)),
          type: keyDef.type,
        };
      }
      // Parse seeds: resolve qualified key names and validate scope
      if (definition.seeds) {
        for (const [shortKey, seedDef] of Object.entries(definition.seeds)) {
          const keyDef = definition.keys[shortKey];
          if (!keyDef) continue; // skip — boot-validator reports unknown keys
          const qualifiedKey = qn(toKebab(name), "config", toKebab(shortKey));
          const scope = seedDef.scope ?? keyDef.scope;
          state.configSeeds.push({
            key: qualifiedKey,
            value: seedDef.value,
            scope,
            tenantId: seedDef.tenantId,
            userId: seedDef.userId,
          });
        }
      }
      return handles as {
        readonly [K in keyof TKeys]: ConfigKeyHandle<TKeys[K]["type"]>;
      }; // @cast-boundary engine-bridge — Mapped-Type-Inference at config()-callsite
    },

    job(
      jobName: string,
      options: Omit<JobDefinition, "name" | "handler">,
      handler: JobHandlerFn,
    ): void {
      // Resolve NameOrRef(s) in trigger.on. Multi-Trigger-Form: Array
      // wird zu Array von resolved strings, Single bleibt single string —
      // job-runner unterscheidet anhand Array.isArray.
      const trigger =
        "on" in options.trigger
          ? {
              on: Array.isArray(options.trigger.on)
                ? options.trigger.on.map(resolveName)
                : resolveName(options.trigger.on as NameOrRef), // @cast-boundary engine-bridge
            }
          : options.trigger;
      state.jobs[jobName] = { ...options, trigger, name: jobName, handler };
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
      state.notifications[notificationName] = {
        name: notificationName,
        trigger: { on: resolveName(definition.trigger.on) },
        recipient: definition.recipient,
        data: definition.data,
        templates: definition.templates,
      };
    },

    translations(def: TranslationsDef): void {
      state.translations = { ...state.translations, ...def.keys };
    },

    defineEvent: <const TInner extends string, TPayload>(
      eventName: TInner,
      schema: ZodType<TPayload>,
      options?: { readonly version?: number; readonly piiFields?: EventPiiFields },
    ): EventDef<TPayload, QualifiedEventName<TName, TInner>> => {
      // Return the fully-qualified event name so callers can pass it
      // straight to ctx.appendEvent without hand-building the
      // "<feature>:event:<name>" shape. Registry keeps state.events keyed by
      // short name — qualification is the framework's job, not the feature
      // author's.
      //
      // The runtime kebab-step (`qn(toKebab(feature), …)`) is mirrored at
      // the type-level by `QualifiedEventName<TName, TInner>` so the
      // returned `name` carries the literal qualified shape that the
      // augmented `KumikoEventTypeMap` keys against.
      const qualified = qn(toKebab(name), "event", toKebab(eventName));
      const version = options?.version ?? 1;
      if (!Number.isInteger(version) || version < 1) {
        throw new Error(
          `[Feature ${name}] defineEvent("${eventName}"): version must be a positive integer, got ${String(version)}`,
        );
      }
      // piiFields misconfiguration is a boot-time error, not a silent
      // plaintext leak: both the pii field and its subjectField must exist
      // on the payload schema (checkable when the schema is a ZodObject).
      const piiFields = options?.piiFields;
      if (piiFields) {
        const shape = schema instanceof ZodObject ? schema.shape : undefined;
        for (const [field, spec] of Object.entries(piiFields)) {
          if (field === spec.subjectField) {
            throw new Error(
              `[Feature ${name}] defineEvent("${eventName}"): piiFields."${field}" cannot use itself as subjectField — the subject id is a plaintext pseudonymous fk, the pii field is the value it owns.`,
            );
          }
          for (const required of [field, spec.subjectField]) {
            if (shape && !(required in shape)) {
              throw new Error(
                `[Feature ${name}] defineEvent("${eventName}"): piiFields references "${required}" which is not a field of the payload schema.`,
              );
            }
          }
        }
      }
      // @cast-boundary engine-bridge — runtime-string mirrors the
      // template-literal-type via QualifiedEventName + toKebab. Both
      // sides are tested (CamelToKebab type-tests + scan-state.events kebab
      // tests), so the cast is a contract, not a typing-loss.
      const def: EventDef<TPayload, QualifiedEventName<TName, TInner>> = {
        name: qualified as QualifiedEventName<TName, TInner>,
        schema,
        version,
        ...(piiFields !== undefined && { piiFields }),
      };
      state.events[eventName] = def;
      return def;
    },

    eventMigration(
      eventName: string,
      fromVersion: number,
      toVersion: number,
      transform: EventUpcastFn | DeclarativeEventMigration,
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
      const list = state.eventMigrations[eventName] ?? [];
      if (list.some((m) => m.fromVersion === fromVersion)) {
        throw new Error(
          `[Feature ${name}] eventMigration("${eventName}", ${fromVersion}, ${toVersion}): ` +
            `a migration from v${fromVersion} is already registered. Each step may only be declared once.`,
        );
      }
      const transformFn =
        typeof transform === "function" ? transform : compileEventMigration(transform);
      list.push({ eventName: qualified, fromVersion, toVersion, transform: transformFn });
      state.eventMigrations[eventName] = list;
    },

    readsConfig(...qualifiedKeys: string[]): void {
      state.configReads.push(...qualifiedKeys);
    },

    referenceData(
      entityRef: NameOrRef,
      data: readonly Record<string, unknown>[],
      options?: { upsertKey?: string },
    ): void {
      state.referenceData.push({
        entityName: resolveName(entityRef),
        data,
        upsertKey: options?.upsertKey,
      });
    },

    extendsRegistrar(extensionName: string, def: RegistrarExtensionDef): void {
      state.registrarExtensions[extensionName] = def;
    },

    useExtension(
      extensionName: string,
      entityRef: NameOrRef,
      options?: Record<string, unknown>,
    ): void {
      state.extensionUsages.push({ extensionName, entityName: resolveName(entityRef), options });
    },

    extensionSelector(extensionName: string, key: { readonly name: string } | string): void {
      if (state.extensionSelectors.some((s) => s.extensionName === extensionName)) {
        throw new Error(
          `[Feature ${name}] extensionSelector("${extensionName}") declared twice — ` +
            `one selector key per extension point.`,
        );
      }
      const qualifiedKey = typeof key === "string" ? key : key.name;
      state.extensionSelectors.push({ extensionName, qualifiedKey });
    },

    /**
     * Marker-Deklaration: dieses Feature stellt eine Cross-Feature-API
     * unter dem genannten Namen bereit. Die eigentliche Implementation
     * wird separat als Query- oder Write-Handler unter dem QN-Pattern
     * registriert; r.exposesApi ist reine Boot-Check-Surface.
     *
     * Beispiel:
     *   defineFeature("compliance-profiles", (r) => {
     *     r.exposesApi("compliance.forTenant");
     *     r.queryHandler({ name: "compliance:query:for-tenant", ... });
     *   });
     *   defineFeature("user-data-rights", (r) => {
     *     r.requires("compliance-profiles");
     *     r.usesApi("compliance.forTenant");
     *     // ruft im Handler: ctx.callQuery("compliance:query:for-tenant", ...)
     *   });
     */
    exposesApi(apiName: string): void {
      if (state.exposedApis.has(apiName)) {
        throw new Error(
          `[Feature ${name}] r.exposesApi("${apiName}") called twice — API names must be unique within a feature.`,
        );
      }
      state.exposedApis.add(apiName);
    },

    /**
     * Declares that this feature calls a cross-feature API. Boot-Validator
     * checkt dass irgendein anderes Feature `r.exposesApi(name)` macht und
     * dass dieses Feature `r.requires` darauf hat.
     */
    usesApi(apiName: string): void {
      state.usedApis.add(apiName);
    },

    metric(shortName: string, options: MetricOptions): void {
      if (state.metrics[shortName]) {
        throw new Error(
          `[Feature ${name}] Metric "${shortName}" already registered. ` +
            `Metric names must be unique per feature.`,
        );
      }
      state.metrics[shortName] = { shortName, ...options };
    },

    envSchema(schema: z.ZodObject<z.ZodRawShape>): void {
      if (state.envSchema !== undefined) {
        throw new Error(
          `[Feature ${name}] r.envSchema() called twice — declare one composed Zod-object per feature.`,
        );
      }
      state.envSchema = schema;
    },

    secret(shortName: string, options: SecretOptions): SecretKeyHandle {
      if (state.secretKeys[shortName]) {
        throw new Error(
          `[Feature ${name}] Secret "${shortName}" already registered. ` +
            `Secret key names must be unique per feature.`,
        );
      }
      // Qualified name follows the framework's "<feature>:<type>:<name>"
      // QN convention — same pattern config / state.jobs / state.events use. toKebab
      // handles the common input shapes ("stripe.apiKey" → "stripe-api-key")
      // so features can declare keys in their natural style without
      // thinking about kebab-case on every call.
      const qualifiedName = qn(toKebab(name), QnTypes.secret, toKebab(shortName));
      state.secretKeys[shortName] = {
        shortName,
        qualifiedName,
        ...options,
      };
      return { name: qualifiedName };
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
      if (state.projections[definition.name]) {
        throw new Error(
          `[Feature ${name}] Projection "${definition.name}" already registered. ` +
            `Projection names must be unique per feature.`,
        );
      }
      state.projections[definition.name] = definition;
    },

    multiStreamProjection(definition: MultiStreamProjectionDefinition): void {
      if (!isKebabSegment(definition.name)) {
        throw new Error(
          `[Feature ${name}] MultiStreamProjection name "${definition.name}" must be kebab-case ` +
            `(lowercase letters, digits, dashes; start with a letter). ` +
            `Got "${definition.name}" — try "${toKebab(definition.name).replace(/_/g, "-")}".`,
        );
      }
      if (state.multiStreamProjections[definition.name] || state.projections[definition.name]) {
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
      state.multiStreamProjections[definition.name] = definition;
    },

    extendEntityProjection(entityName: string, extension: EntityProjectionExtension): void {
      if (Object.keys(extension.apply).length === 0) {
        throw new Error(
          `[Feature ${name}] extendEntityProjection("${entityName}") has no apply handlers. ` +
            `Declare at least one event type, otherwise the rebuild replay has nothing to do.`,
        );
      }
      // Entity existence + apply-key collisions are validated at registry
      // build — r.entity may legally be called after this in the same feature.
      const list = state.entityProjectionExtensions[entityName] ?? [];
      list.push(extension);
      state.entityProjectionExtensions[entityName] = list;
    },

    authClaims(fn: AuthClaimsFn): void {
      state.authClaimsHooks.push(fn);
    },

    screen(definition: ScreenDefinition): void {
      // Reject kebab-drift at registration-time so the stack trace points at
      // the feature file, not at registry-boot. Same guard pattern as
      // r.projection / r.multiStreamProjection.
      if (!isKebabSegment(definition.id)) {
        throw new Error(
          `[Feature ${name}] Screen id "${definition.id}" must be kebab-case ` +
            `(lowercase letters, digits, dashes; start with a letter). ` +
            `Got "${definition.id}" — try "${toKebab(definition.id).replace(/_/g, "-")}".`,
        );
      }
      if (state.screens[definition.id]) {
        throw new Error(
          `[Feature ${name}] Screen "${definition.id}" already registered. ` +
            `Screen ids must be unique per feature.`,
        );
      }
      state.screens[definition.id] = definition;
    },

    nav(definition: NavDefinition): void {
      // Reject kebab-drift at registration-time so the stack trace points at
      // the feature file, not at registry-boot. Same guard pattern as
      // r.projection / r.multiStreamProjection / r.screen.
      if (!isKebabSegment(definition.id)) {
        throw new Error(
          `[Feature ${name}] Nav id "${definition.id}" must be kebab-case ` +
            `(lowercase letters, digits, dashes; start with a letter). ` +
            `Got "${definition.id}" — try "${toKebab(definition.id).replace(/_/g, "-")}".`,
        );
      }
      if (state.navs[definition.id]) {
        throw new Error(
          `[Feature ${name}] Nav entry "${definition.id}" already registered. ` +
            `Nav ids must be unique per feature.`,
        );
      }
      state.navs[definition.id] = definition;
    },

    workspace(definition: WorkspaceDefinition): void {
      // Same kebab guard as r.screen / r.nav so authoring-time mistakes
      // surface at the feature file, not deep in registry boot.
      if (!isKebabSegment(definition.id)) {
        throw new Error(
          `[Feature ${name}] Workspace id "${definition.id}" must be kebab-case ` +
            `(lowercase letters, digits, dashes; start with a letter). ` +
            `Got "${definition.id}" — try "${toKebab(definition.id).replace(/_/g, "-")}".`,
        );
      }
      if (state.workspaces[definition.id]) {
        throw new Error(
          `[Feature ${name}] Workspace "${definition.id}" already registered. ` +
            `Workspace ids must be unique per feature.`,
        );
      }
      state.workspaces[definition.id] = definition;
    },

    httpRoute(definition: HttpRouteDefinition): void {
      // Path-Validation: muss mit "/" beginnen, keine /api/-Routes (die
      // sind dem Dispatcher reserviert; eine HTTP-Route die /api/foo
      // belegt, würde die Auth-Middleware umgehen ohne dass der Author
      // das ausgesprochen hat — bewusster Block).
      if (!definition.path.startsWith("/")) {
        throw new Error(
          `[Feature ${name}] httpRoute path "${definition.path}" must start with "/". ` +
            `Got "${definition.path}".`,
        );
      }
      if (definition.path === "/api" || definition.path.startsWith("/api/")) {
        throw new Error(
          `[Feature ${name}] httpRoute path "${definition.path}" is in the /api/* namespace ` +
            `which is reserved for the dispatcher (write/query/batch/auth/sse). ` +
            `Pick a different path or use r.queryHandler / r.writeHandler.`,
        );
      }
      const key = `${definition.method} ${definition.path}`;
      if (state.httpRoutes[key]) {
        throw new Error(
          `[Feature ${name}] HTTP-Route "${key}" already registered. ` +
            `method + path must be unique per feature.`,
        );
      }
      state.httpRoutes[key] = definition;
    },

    rawTable(rawTableName: string, table: unknown, options: RawTableOptions): void {
      // Same kebab guard as r.projection / r.screen / r.nav so authoring-time
      // mistakes surface at the feature file, not deep in registry boot.
      if (!isKebabSegment(rawTableName)) {
        throw new Error(
          `[Feature ${name}] Raw-table name "${rawTableName}" must be kebab-case ` +
            `(lowercase letters, digits, dashes; start with a letter). ` +
            `Got "${rawTableName}" — try "${toKebab(rawTableName).replace(/_/g, "-")}".`,
        );
      }
      if (state.rawTables[rawTableName]) {
        throw new Error(
          `[Feature ${name}] r.rawTable("${rawTableName}") already registered. ` +
            `Raw-table names must be unique per feature.`,
        );
      }
      // The `reason` is the marker that justifies the bypass — empty
      // strings would defeat the audit trail. Reject early so the
      // failure points at the feature file.
      if (typeof options.reason !== "string" || options.reason.trim().length === 0) {
        throw new Error(
          `[Feature ${name}] r.rawTable("${rawTableName}"): options.reason must be a ` +
            `non-empty string. The reason is the marker that justifies the bypass — ` +
            `if you can't write one, declare data via r.entity() instead.`,
        );
      }
      state.rawTables[rawTableName] = {
        name: rawTableName,
        table,
        reason: options.reason,
      };
    },

    unmanagedTable(meta: EntityTableMeta, options: UnmanagedTableOptions): void {
      // Name comes from the meta itself — apps already give the table a
      // name when calling defineUnmanagedTable, no need to repeat it.
      const tableName = meta.tableName;
      if (!isKebabSegment(tableName.replace(/_/g, "-"))) {
        // EntityTableMeta uses snake_case for tableName (matches Postgres
        // convention); we just guard against truly broken input.
        throw new Error(
          `[Feature ${name}] Unmanaged-table name "${tableName}" must be a ` +
            `valid identifier (lowercase letters, digits, underscores; start with a letter).`,
        );
      }
      if (state.unmanagedTables[tableName]) {
        throw new Error(
          `[Feature ${name}] r.unmanagedTable("${tableName}") already registered. ` +
            `Unmanaged-table names must be unique per feature.`,
        );
      }
      if (typeof options.reason !== "string" || options.reason.trim().length === 0) {
        throw new Error(
          `[Feature ${name}] r.unmanagedTable("${tableName}"): options.reason must be a ` +
            `non-empty string. The reason justifies the audit-trail bypass — ` +
            `if you can't write one, declare data via r.entity() instead.`,
        );
      }
      state.unmanagedTables[tableName] = {
        name: tableName,
        meta,
        reason: options.reason,
        ...(options.piiEncryptedOnWrite && { piiEncryptedOnWrite: true }),
      };
    },

    claimKey<T extends ClaimKeyType>(
      shortName: string,
      options: { readonly type: T },
    ): ClaimKeyHandle<T> {
      if (state.claimKeys[shortName]) {
        throw new Error(
          `[Feature ${name}] Claim key "${shortName}" already declared. ` +
            "Claim short-names must be unique per feature.",
        );
      }
      // Claim keys are NOT full QNs — the JWT shape is 2-segment
      // "<featureName>:<shortName>" (same as Translation keys), not
      // kebab-cased. The authClaims resolver prefixes with the raw
      // feature.name + the raw inner key the hook returns, so the handle's
      // `name` must match that literal string exactly for `readClaim` to
      // find the value. kebab-conversion here would break the round-trip.
      const qualifiedName = `${name}:${shortName}`;
      state.claimKeys[shortName] = {
        shortName,
        qualifiedName,
        type: options.type,
      };
      return { name: qualifiedName, type: options.type };
    },

    treeActions<const TActions extends Record<string, TreeActionDef>>(
      actions: TActions,
    ): TreeActionsHandle<TName, TActions> {
      // Only-once-guard: zweiter Aufruf ist Author-Bug, soll am
      // Feature-File aufschlagen (gleicher Stil wie r.toggleable).
      if (state.treeActions !== undefined) {
        throw new Error(
          `[Feature ${name}] r.treeActions() already called. ` +
            `Each feature may declare a single tree-actions schema.`,
        );
      }
      state.treeActions = actions;
      // Return typed handle für setup-export. Frozen damit Caller die
      // Map nicht nachträglich mutieren (würde Pattern-AST + Runtime-
      // Lookup divergieren lassen).
      return Object.freeze({
        id: name,
        treeActions: actions,
      });
    },
  };

  const exports = setup(registrar) as TExports; // @cast-boundary engine-bridge

  return {
    name,
    ...(state.description !== undefined && { description: state.description }),
    systemScope: state.isSystemScoped,
    exports,
    requires: state.requires,
    optionalRequires: state.optionalRequires,
    requiredProjections: state.requiredProjections,
    requiredSteps: state.requiredSteps,
    ...(state.toggleableDefault !== undefined && { toggleableDefault: state.toggleableDefault }),
    ...(state.uiHints !== undefined && { uiHints: state.uiHints }),
    entities: state.entities,
    entityTables: state.entityTables,
    relations: state.relations,
    writeHandlers: state.writeHandlers,
    queryHandlers: state.queryHandlers,
    translations: state.translations,
    hooks: {
      validation: state.validationHooks,
      preSave: state.lifecycleHooks["preSave"] ?? {},
      postSave: state.phasedLifecycleHooks.postSave,
      preDelete: state.phasedLifecycleHooks.preDelete,
      postDelete: state.phasedLifecycleHooks.postDelete,
      preQuery: state.lifecycleHooks["preQuery"] ?? {},
      postQuery: state.lifecycleHooks["postQuery"] ?? {},
      // @cast-boundary engine-bridge — die Hook-Registrierung erased die
      // per-Slot-Signaturen zu LifecycleHookFn (Union, s. Cast in
      // addLifecycleHook); die Branches dort sind die einzigen Producer und
      // schreiben pro Slot typrichtig.
    } as HookMap,
    entityHooks: {
      postSave: state.entityPostSave,
      preDelete: state.entityPreDelete,
      postDelete: state.entityPostDelete,
      postQuery: state.entityPostQuery,
    },
    searchPayloadExtensions: state.searchPayloadExtensions,
    configKeys: state.configKeys,
    configSeeds: state.configSeeds,
    jobs: state.jobs,
    notifications: state.notifications,
    registrarExtensions: state.registrarExtensions,
    extensionUsages: state.extensionUsages,
    extensionSelectors: state.extensionSelectors,
    exposedApis: state.exposedApis,
    usedApis: state.usedApis,
    referenceData: state.referenceData,
    events: state.events,
    eventMigrations: state.eventMigrations,
    configReads: state.configReads,
    handlerEntityMappings: state.handlerEntityMappings,
    metrics: state.metrics,
    secretKeys: state.secretKeys,
    projections: state.projections,
    entityProjectionExtensions: state.entityProjectionExtensions,
    multiStreamProjections: state.multiStreamProjections,
    authClaimsHooks: state.authClaimsHooks,
    claimKeys: state.claimKeys,
    screens: state.screens,
    navs: state.navs,
    workspaces: state.workspaces,
    httpRoutes: state.httpRoutes,
    rawTables: state.rawTables,
    unmanagedTables: state.unmanagedTables,
    ...(state.treeActions !== undefined && { treeActions: state.treeActions }),
    ...(state.envSchema !== undefined && { envSchema: state.envSchema }),
  };
}

// EventUpcastFn. Fixed order: rename → default → map.
function compileEventMigration(spec: DeclarativeEventMigration): EventUpcastFn {
  return (payload) => {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Declarative event migration expects an object payload");
    }
    // @cast-boundary parse — payload is guarded as a plain object above
    const next = { ...(payload as Record<string, unknown>) };
    for (const [from, to] of Object.entries(spec.rename ?? {})) {
      if (from in next) {
        next[to] = next[from];
        delete next[from];
      }
    }
    for (const [key, value] of Object.entries(spec.default ?? {})) {
      if (!(key in next)) next[key] = value;
    }
    for (const [key, fn] of Object.entries(spec.map ?? {})) {
      if (key in next) next[key] = fn(next[key]);
    }
    return next;
  };
}
