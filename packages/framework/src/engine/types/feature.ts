import type { ZodType, z } from "zod";
import type { EventConsumerHandler } from "../../pipeline/event-dispatcher";
import type { QueryHandlerDefinition, WriteHandlerDefinition } from "../define-handler";
import type {
  ConfigDefinition,
  ConfigKeyDefinition,
  JobDefinition,
  JobHandlerFn,
  NotificationDataFn,
  NotificationDefinition,
  NotificationRecipientFn,
  NotificationTemplateFn,
  ReferenceDataDef,
  RegistrarExtensionDef,
  RegistrarExtensionRegistration,
  TranslationKeys,
  TranslationsDef,
} from "./config";
import type { EntityDefinition } from "./fields";
import type {
  AccessRule,
  CrudRefs,
  EntityRef,
  EventDef,
  HandlerRef,
  NameOrRef,
  QueryHandlerDef,
  QueryHandlerFn,
  WriteHandlerDef,
  WriteHandlerFn,
} from "./handlers";
import type {
  EntityHookMap,
  HookMap,
  HookPhase,
  PostDeleteHookFn,
  PostSaveHookFn,
  PreDeleteHookFn,
  PreQueryHookFn,
  PreSaveHookFn,
  ValidationHookFn,
} from "./hooks";
import type { ProjectionDefinition } from "./projection";
import type { EntityRelations, RelationDefinition } from "./relations";

// --- Post-Event subscribers (declared by features via r.postEvent()) ---
//
// A subscriber runs async after the event is durably appended (the event-
// dispatcher reads from the events-table via a persistent per-subscriber
// cursor). Use this for: SSE broadcast, search-index updates, cross-feature
// reactions, external HTTP calls, message-bus dispatch.
//
// Naming: "<feature>:consumer:<short>". Framework qualifies automatically so
// two features can't collide on the same consumer name.
//
// Ordering: per-subscriber, strictly by events.id. Handler throws → retry
// the SAME event up to maxAttempts, then the subscriber pauses (status
// "dead"). Other subscribers keep running independently.
export type PostEventSubscriberDef = {
  readonly name: string;
  readonly handler: EventConsumerHandler;
};

// --- Metrics (declared by features via r.metric()) ---

export type FeatureMetricType = "counter" | "histogram" | "gauge";

// The user-facing short form written in a feature. The Framework prefixes it
// with `kumiko_<featureName>_` to produce the fully-qualified Prometheus name.
export type FeatureMetricDef = {
  readonly shortName: string;
  readonly type: FeatureMetricType;
  readonly description?: string;
  readonly labels?: readonly string[];
  readonly buckets?: readonly number[];
  readonly unit?: string;
  // When true, Framework auto-adds tenant_id to labels (ctx-driven). Default
  // false — cardinality multiplies by tenant count, so opt-in.
  readonly tenantLabel?: boolean;
};

export type MetricOptions = Omit<FeatureMetricDef, "shortName">;

// --- Feature Definition (output of defineFeature) ---

export type FeatureDefinition = {
  readonly name: string;
  readonly systemScope: boolean;
  readonly requires: readonly string[];
  readonly optionalRequires: readonly string[];
  readonly entities: Readonly<Record<string, EntityDefinition>>;
  readonly relations: Readonly<Record<string, EntityRelations>>;
  readonly writeHandlers: Readonly<Record<string, WriteHandlerDef>>;
  readonly queryHandlers: Readonly<Record<string, QueryHandlerDef>>;
  readonly translations: TranslationKeys;
  readonly hooks: HookMap;
  readonly entityHooks: EntityHookMap;
  readonly configKeys: Readonly<Record<string, ConfigKeyDefinition>>;
  readonly jobs: Readonly<Record<string, JobDefinition>>;
  readonly registrarExtensions: Readonly<Record<string, RegistrarExtensionDef>>;
  readonly extensionUsages: readonly RegistrarExtensionRegistration[];
  readonly referenceData: readonly ReferenceDataDef[];
  readonly notifications: Readonly<Record<string, NotificationDefinition>>;
  readonly events: Readonly<Record<string, EventDef>>;
  readonly configReads: readonly string[];
  // Explicit handler → entity mapping set by r.crud() and r.writeHandler()/r.queryHandler()
  readonly handlerEntityMappings: Readonly<Record<string, string>>;
  // Metrics declared via r.metric(). Short names — Framework prefixes on boot.
  readonly metrics: Readonly<Record<string, FeatureMetricDef>>;
  // Projections declared via r.projection(). Keyed by projection name; executor
  // looks them up by source-entity at write-time.
  readonly projections: Readonly<Record<string, ProjectionDefinition>>;
  // Post-event subscribers declared via r.postEvent(). Keyed by qualified
  // consumer name; the event-dispatcher looks them up when scheduling a pass.
  readonly postEventSubscribers: Readonly<Record<string, PostEventSubscriberDef>>;
};

// --- Feature Registrar (the "r" object in defineFeature) ---

type RefOrRefs = NameOrRef | readonly NameOrRef[];

export type FeatureRegistrar = {
  systemScope(): void;
  requires(...featureNames: string[]): void;
  optionalRequires(...featureNames: string[]): void;

  entity(name: string, definition: EntityDefinition): EntityRef;

  writeHandler<TName extends string, TSchema extends ZodType>(
    def: WriteHandlerDefinition<TName, TSchema>,
  ): HandlerRef;
  writeHandler<TSchema extends ZodType>(
    name: string,
    schema: TSchema,
    handler: WriteHandlerFn<z.infer<TSchema>>,
    options?: { access?: AccessRule },
  ): HandlerRef;

  queryHandler<TName extends string, TSchema extends ZodType>(
    def: QueryHandlerDefinition<TName, TSchema>,
  ): HandlerRef;
  queryHandler<TSchema extends ZodType>(
    name: string,
    schema: TSchema,
    handler: QueryHandlerFn<z.infer<TSchema>>,
    options?: { access?: AccessRule },
  ): HandlerRef;

  crud(
    entity: NameOrRef,
    options?: {
      // Single AccessRule applies to every generated handler. Pass a map
      // with per-handler keys ({ create, update, delete, restore, list, detail })
      // when the handlers need different access (e.g. delete=Admin, list=openToAll).
      access?:
        | AccessRule
        | {
            readonly create?: AccessRule;
            readonly update?: AccessRule;
            readonly delete?: AccessRule;
            readonly restore?: AccessRule;
            readonly list?: AccessRule;
            readonly detail?: AccessRule;
          };
    },
  ): CrudRefs;

  relation(entity: NameOrRef, relationName: string, definition: RelationDefinition): void;

  hook(type: "validation", target: RefOrRefs, fn: ValidationHookFn): void;
  hook(type: "preSave", target: RefOrRefs, fn: PreSaveHookFn): void;
  hook(
    type: "postSave",
    target: RefOrRefs,
    fn: PostSaveHookFn,
    options?: { phase?: HookPhase },
  ): void;
  // preDelete always runs in-transaction (it guards the delete — there is no
  // meaningful "after" for a pre-hook). No phase option.
  hook(type: "preDelete", target: RefOrRefs, fn: PreDeleteHookFn): void;
  hook(
    type: "postDelete",
    target: RefOrRefs,
    fn: PostDeleteHookFn,
    options?: { phase?: HookPhase },
  ): void;
  hook(type: "preQuery", target: RefOrRefs, fn: PreQueryHookFn): void;

  entityHook(
    type: "postSave",
    entity: NameOrRef,
    fn: PostSaveHookFn,
    options?: { phase?: HookPhase },
  ): void;
  entityHook(type: "preDelete", entity: NameOrRef, fn: PreDeleteHookFn): void;
  entityHook(
    type: "postDelete",
    entity: NameOrRef,
    fn: PostDeleteHookFn,
    options?: { phase?: HookPhase },
  ): void;

  config(definition: ConfigDefinition): void;

  job(name: string, options: Omit<JobDefinition, "name" | "handler">, handler: JobHandlerFn): void;

  notification(
    name: string,
    definition: {
      readonly trigger: { readonly on: NameOrRef };
      readonly recipient: NotificationRecipientFn;
      readonly data: NotificationDataFn;
      readonly templates?: Readonly<Record<string, NotificationTemplateFn>>;
    },
  ): void;

  translations(def: TranslationsDef): void;

  defineEvent<TPayload>(name: string, schema: ZodType<TPayload>): EventDef<TPayload>;

  readsConfig(...qualifiedKeys: string[]): void;

  referenceData(
    entity: NameOrRef,
    data: readonly Record<string, unknown>[],
    options?: { upsertKey?: string },
  ): void;

  extendsRegistrar(name: string, def: RegistrarExtensionDef): void;

  useExtension(extensionName: string, entity: NameOrRef, options?: Record<string, unknown>): void;

  // Declare a metric. Short name (without kumiko_<feature>_ prefix) — Framework
  // qualifies it on boot. Validation (snake_case + typ-suffix) runs at boot.
  // Usage at runtime: ctx.metrics.inc("created_total", { status: "new" }).
  metric(shortName: string, options: MetricOptions): void;

  // Register a projection driven by events of one or more source entities.
  // The runtime fires projection.apply[event.type] inside the event-store's
  // transaction, so projections stay consistent with the events that feed them.
  projection(definition: ProjectionDefinition): void;

  // Register an async post-event subscriber. The event-dispatcher reads the
  // events-table via a per-subscriber cursor and calls the handler for each
  // event, in events.id order. Handler throws → retried until maxAttempts,
  // then the subscriber pauses (dead-letter) while the others keep running.
  // Use for side-effects: SSE broadcast, search-index, external calls.
  postEvent(name: string, handler: EventConsumerHandler): void;
};

// --- Registry (created from features) ---

export type Registry = {
  readonly features: ReadonlyMap<string, FeatureDefinition>;

  getFeature(name: string): FeatureDefinition | undefined;
  getEntity(name: string): EntityDefinition | undefined;
  getWriteHandler(name: string): WriteHandlerDef | undefined;
  getQueryHandler(name: string): QueryHandlerDef | undefined;
  getSearchableFields(entityName: string): readonly string[];
  getSortableFields(entityName: string): readonly string[];
  getRelations(entityName: string): EntityRelations;
  getSearchIncludes(entityName: string): ReadonlyMap<string, readonly string[]>;
  getIncomingRelations(entityName: string): ReadonlyArray<{
    sourceEntity: string;
    relationName: string;
    relation: RelationDefinition;
  }>;
  getPreSaveHooks(name: string): readonly PreSaveHookFn[];
  getPostSaveHooks(name: string, phase?: HookPhase): readonly PostSaveHookFn[];
  getPreDeleteHooks(name: string, phase?: HookPhase): readonly PreDeleteHookFn[];
  getPostDeleteHooks(name: string, phase?: HookPhase): readonly PostDeleteHookFn[];
  getPreQueryHooks(name: string): readonly PreQueryHookFn[];
  getEntityPostSaveHooks(entityName: string, phase?: HookPhase): readonly PostSaveHookFn[];
  getEntityPreDeleteHooks(entityName: string, phase?: HookPhase): readonly PreDeleteHookFn[];
  getEntityPostDeleteHooks(entityName: string, phase?: HookPhase): readonly PostDeleteHookFn[];
  getHandlerEntity(qualifiedHandler: string): string | undefined;
  isHandlerSystemScoped(qualifiedHandler: string): boolean;
  getHandlerFeature(qualifiedHandler: string): string | undefined;
  // All metrics from all features, keyed by fully-qualified name
  // (kumiko_<feature>_<shortName>). Consumed at boot to register them on the
  // active Meter.
  getAllMetrics(): ReadonlyMap<string, FeatureMetricDef & { readonly featureName: string }>;
  getAllTranslations(): TranslationKeys;
  getConfigKey(qualifiedKey: string): ConfigKeyDefinition | undefined;
  getAllConfigKeys(): ReadonlyMap<string, ConfigKeyDefinition>;
  getJob(qualifiedName: string): JobDefinition | undefined;
  getAllJobs(): ReadonlyMap<string, JobDefinition>;
  getEvent(qualifiedName: string): EventDef | undefined;
  getExtension(name: string): RegistrarExtensionDef | undefined;
  getExtensionUsages(extensionName: string): readonly RegistrarExtensionRegistration[];
  getAllNotifications(): ReadonlyMap<string, NotificationDefinition>;
  getAllReferenceData(): readonly ReferenceDataDef[];
  // Look up projections by source-entity name. Empty list when no projection
  // feeds off the entity — event-store-executor uses this as the hot-path.
  getProjectionsForSource(entityName: string): readonly ProjectionDefinition[];
  getAllProjections(): ReadonlyMap<string, ProjectionDefinition>;

  // All registered postEvent subscribers, keyed by qualified consumer name.
  // Event-dispatcher iterates this to schedule a per-consumer pass.
  getAllPostEventSubscribers(): ReadonlyMap<string, PostEventSubscriberDef>;
};
