import type { PgTable } from "drizzle-orm/pg-core";
import type { ZodType, z } from "zod";
import { toTableName } from "../db/table-builder";
import { LifecycleHookTypes } from "./constants";
import type { QueryHandlerDefinition, WriteHandlerDefinition } from "./define-handler";
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
  EntityDefinition,
  EntityRef,
  EventDef,
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
  OwnedFn,
  PhasedHook,
  PostDeleteHookFn,
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
  SecretKeyDefinition,
  SecretKeyHandle,
  SecretOptions,
  TranslationKeys,
  TranslationsDef,
  ValidationHookFn,
  WriteHandlerDef,
  WriteHandlerFn,
} from "./types";
import { HookPhases } from "./types";
import { resolveName } from "./types/handlers";
import type { HttpRouteDefinition } from "./types/http-route";
import type { NavDefinition } from "./types/nav";
import type { ScreenDefinition } from "./types/screen";
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
export function defineFeature<const TName extends string, TExports = undefined>(
  name: TName,
  setup: (r: FeatureRegistrar<TName>) => TExports,
): FeatureDefinition & { readonly exports: TExports } {
  const requires: string[] = [];
  const optionalRequires: string[] = [];
  // Read-side projection-tables declared via r.requires.projection("table").
  // Boot-validator checks unsafeProjection-* step calls against this set.
  const requiredProjections = new Set<string>();
  const entities: Record<string, EntityDefinition> = {};
  const relations: Record<string, Record<string, RelationDefinition>> = {};
  const writeHandlers: Record<string, WriteHandlerDef> = {};
  const queryHandlers: Record<string, QueryHandlerDef> = {};
  const validationHooks: Record<string, ValidationHookFn> = {};
  // preSave/preQuery stay unphased (owned-fn); postSave/preDelete/postDelete
  // are phased (owned-fn + phase). Each hook carries its owning feature so
  // the lifecycle pipeline can filter by effectiveFeatures without a parallel
  // bookkeeping structure.
  const lifecycleHooks: Record<string, Record<string, OwnedFn<LifecycleHookFn>[]>> = {};
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
  const secretKeys: Record<string, SecretKeyDefinition> = {};
  const projections: Record<string, ProjectionDefinition> = {};
  const multiStreamProjections: Record<string, MultiStreamProjectionDefinition> = {};
  const rawTables: Record<string, RawTableEntry> = {};
  const authClaimsHooks: AuthClaimsFn[] = [];
  const claimKeys: Record<string, ClaimKeyDefinition> = {};
  const screens: Record<string, ScreenDefinition> = {};
  const navs: Record<string, NavDefinition> = {};
  const workspaces: Record<string, WorkspaceDefinition> = {};
  const httpRoutes: Record<string, HttpRouteDefinition> = {};
  let translations: TranslationKeys = {};

  for (const t of LIFECYCLE_TYPES) {
    lifecycleHooks[t] = {};
  }

  let isSystemScoped = false;
  let toggleableDefault: boolean | undefined;

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

  const registrar: FeatureRegistrar<TName> = {
    systemScope(): void {
      isSystemScoped = true;
    },

    requires: (() => {
      const fn = (...featureNames: string[]) => {
        requires.push(...featureNames);
      };
      fn.projection = (tableName: string) => {
        requiredProjections.add(tableName);
      };
      return fn as import("./types/feature").RequiresApi;
    })(),

    optionalRequires(...featureNames: string[]): void {
      optionalRequires.push(...featureNames);
    },

    toggleable(options: { default: boolean }): void {
      if (toggleableDefault !== undefined) {
        throw new Error(
          `[Feature ${name}] r.toggleable() called twice — a feature's toggleable status is declared once`,
        );
      }
      toggleableDefault = options.default;
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
            perform: def.perform as import("./types/step").PipelineDef,
          }),
        };
        tryMapEntity(def.name);
        return { name: def.name };
      }
      if (!schema || !handler)
        throw new Error("writeHandler inline form requires schema + handler");
      writeHandlers[nameOrDef] = {
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
        queryHandlers[def.name] = {
          name: def.name,
          schema: def.schema,
          // @cast-boundary engine-bridge — typed Dev-API → erased internal storage
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
        handler: handler as QueryHandlerFn, // @cast-boundary engine-bridge
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

      // Hook-fn casts unten alle: @cast-boundary engine-bridge
      // — typed Dev-API (LifecycleHookFn|ValidationHookFn) → erased Map<name, fn>.
      if (type === "validation") {
        for (const n of names) {
          validationHooks[n] = fn as ValidationHookFn; // @cast-boundary engine-bridge
        }
        // skip: validation hooks have no phase, stored and done
        return;
      }

      if (type === LifecycleHookTypes.preSave || type === LifecycleHookTypes.preQuery) {
        if (!lifecycleHooks[type]) lifecycleHooks[type] = {};
        for (const n of names) {
          if (!lifecycleHooks[type][n]) lifecycleHooks[type][n] = [];
          lifecycleHooks[type][n].push({ fn: fn as LifecycleHookFn, featureName: name }); // @cast-boundary engine-bridge
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
        bucket[n].push({ fn: fn as LifecycleHookFn, phase, featureName: name }); // @cast-boundary engine-bridge
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
        entityPostSave[entityName].push({ fn: fn as PostSaveHookFn, phase, featureName: name }); // @cast-boundary engine-bridge
      } else if (type === LifecycleHookTypes.preDelete) {
        if (!entityPreDelete[entityName]) entityPreDelete[entityName] = [];
        entityPreDelete[entityName].push({
          fn: fn as PreDeleteHookFn, // @cast-boundary engine-bridge
          phase: HookPhases.inTransaction,
          featureName: name,
        });
      } else if (type === LifecycleHookTypes.postDelete) {
        const phase = options?.phase ?? HookPhases.afterCommit;
        if (!entityPostDelete[entityName]) entityPostDelete[entityName] = [];
        entityPostDelete[entityName].push({ fn: fn as PostDeleteHookFn, phase, featureName: name }); // @cast-boundary engine-bridge
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
                : resolveName(options.trigger.on as NameOrRef),
            }
          : options.trigger;
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

    defineEvent: <const TInner extends string, TPayload>(
      eventName: TInner,
      schema: ZodType<TPayload>,
      options?: { readonly version?: number },
    ): EventDef<TPayload, QualifiedEventName<TName, TInner>> => {
      // Return the fully-qualified event name so callers can pass it
      // straight to ctx.appendEvent without hand-building the
      // "<feature>:event:<name>" shape. Registry keeps events keyed by
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
      // @cast-boundary engine-bridge — runtime-string mirrors the
      // template-literal-type via QualifiedEventName + toKebab. Both
      // sides are tested (CamelToKebab type-tests + scan-events kebab
      // tests), so the cast is a contract, not a typing-loss.
      const def: EventDef<TPayload, QualifiedEventName<TName, TInner>> = {
        name: qualified as QualifiedEventName<TName, TInner>,
        schema,
        version,
      };
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

    secret(shortName: string, options: SecretOptions): SecretKeyHandle {
      if (secretKeys[shortName]) {
        throw new Error(
          `[Feature ${name}] Secret "${shortName}" already registered. ` +
            `Secret key names must be unique per feature.`,
        );
      }
      // Qualified name follows the framework's "<feature>:<type>:<name>"
      // QN convention — same pattern config / jobs / events use. toKebab
      // handles the common input shapes ("stripe.apiKey" → "stripe-api-key")
      // so features can declare keys in their natural style without
      // thinking about kebab-case on every call.
      const qualifiedName = qn(toKebab(name), QnTypes.secret, toKebab(shortName));
      secretKeys[shortName] = {
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

    authClaims(fn: AuthClaimsFn): void {
      authClaimsHooks.push(fn);
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
      if (screens[definition.id]) {
        throw new Error(
          `[Feature ${name}] Screen "${definition.id}" already registered. ` +
            `Screen ids must be unique per feature.`,
        );
      }
      screens[definition.id] = definition;
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
      if (navs[definition.id]) {
        throw new Error(
          `[Feature ${name}] Nav entry "${definition.id}" already registered. ` +
            `Nav ids must be unique per feature.`,
        );
      }
      navs[definition.id] = definition;
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
      if (workspaces[definition.id]) {
        throw new Error(
          `[Feature ${name}] Workspace "${definition.id}" already registered. ` +
            `Workspace ids must be unique per feature.`,
        );
      }
      workspaces[definition.id] = definition;
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
      if (httpRoutes[key]) {
        throw new Error(
          `[Feature ${name}] HTTP-Route "${key}" already registered. ` +
            `method + path must be unique per feature.`,
        );
      }
      httpRoutes[key] = definition;
    },

    rawTable(rawTableName: string, table: PgTable, options: RawTableOptions): void {
      // Same kebab guard as r.projection / r.screen / r.nav so authoring-time
      // mistakes surface at the feature file, not deep in registry boot.
      if (!isKebabSegment(rawTableName)) {
        throw new Error(
          `[Feature ${name}] Raw-table name "${rawTableName}" must be kebab-case ` +
            `(lowercase letters, digits, dashes; start with a letter). ` +
            `Got "${rawTableName}" — try "${toKebab(rawTableName).replace(/_/g, "-")}".`,
        );
      }
      if (rawTables[rawTableName]) {
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
      rawTables[rawTableName] = {
        name: rawTableName,
        table,
        reason: options.reason,
      };
    },

    claimKey<T extends ClaimKeyType>(
      shortName: string,
      options: { readonly type: T },
    ): ClaimKeyHandle<T> {
      if (claimKeys[shortName]) {
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
      claimKeys[shortName] = {
        shortName,
        qualifiedName,
        type: options.type,
      };
      return { name: qualifiedName, type: options.type };
    },
  };

  const exports = setup(registrar) as TExports;

  return {
    name,
    systemScope: isSystemScoped,
    exports,
    requires,
    optionalRequires,
    requiredProjections,
    ...(toggleableDefault !== undefined && { toggleableDefault }),
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
    secretKeys,
    projections,
    multiStreamProjections,
    authClaimsHooks,
    claimKeys,
    screens,
    navs,
    workspaces,
    httpRoutes,
    rawTables,
  };
}
