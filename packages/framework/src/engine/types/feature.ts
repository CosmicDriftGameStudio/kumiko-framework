import type { ZodType, z } from "zod";
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
  EventMigrationDef,
  EventUpcastFn,
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
import type { MultiStreamProjectionDefinition, ProjectionDefinition } from "./projection";
import type { EntityRelations, RelationDefinition } from "./relations";

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
  // Event schema migrations declared via r.eventMigration(). Keyed by event
  // short-name; each entry carries the step transforms (fromVersion →
  // toVersion). The registry stitches these with the defineEvent-declared
  // current version and exposes a per-qualified-name upcaster chain.
  readonly eventMigrations: Readonly<Record<string, readonly EventMigrationDef[]>>;
  readonly configReads: readonly string[];
  // Explicit handler → entity mapping set by r.crud() and r.writeHandler()/r.queryHandler()
  readonly handlerEntityMappings: Readonly<Record<string, string>>;
  // Metrics declared via r.metric(). Short names — Framework prefixes on boot.
  readonly metrics: Readonly<Record<string, FeatureMetricDef>>;
  // Projections declared via r.projection(). Keyed by projection name; executor
  // looks them up by source-entity at write-time.
  readonly projections: Readonly<Record<string, ProjectionDefinition>>;
  // Multi-stream projections — cross-aggregate async read-models. Keyed by
  // short name; the dispatcher wraps each into an EventConsumer with its
  // own cursor.
  readonly multiStreamProjections: Readonly<Record<string, MultiStreamProjectionDefinition>>;
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

  // Register an event payload shape. Returns the qualified def so callers
  // can pass `.name` to ctx.appendEvent without hand-building the
  // "<feature>:event:<short>" string.
  //
  // `options.version` declares the CURRENT schema generation. Defaults to 1
  // on first registration. When you bump the payload shape, raise version
  // AND register r.eventMigration(shortName, N, N+1, transform) — the
  // framework refuses to boot if the chain from 1 → version has gaps.
  defineEvent<TPayload>(
    name: string,
    schema: ZodType<TPayload>,
    options?: { readonly version?: number },
  ): EventDef<TPayload>;

  // Register a step-wise payload transform for event-schema evolution.
  // `eventName` is the SHORT name (same as defineEvent). `toVersion` must
  // be `fromVersion + 1` — chain larger jumps by registering each step.
  // Transforms are pure functions: old payload in, new payload out. They
  // run once per read (not once per event persisted), so keep them cheap.
  eventMigration(
    eventName: string,
    fromVersion: number,
    toVersion: number,
    transform: EventUpcastFn,
  ): void;

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

  // Register a cross-aggregate async projection. The event-dispatcher owns
  // delivery via a dedicated cursor — at-least-once, strictly-ordered by
  // events.id. Handlers must be idempotent. Marten's MultiStreamProjection
  // equivalent: customer billing summaries, cross-feature audit views,
  // saga state machines where a single view spans many aggregate types.
  // Omit `table` for pure side-effect handlers (notifications, webhooks,
  // external-system sync) — the dispatcher still delivers at-least-once with
  // per-consumer ordering and dead-letter behaviour.
  multiStreamProjection(definition: MultiStreamProjectionDefinition): void;
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

  // Upcaster chain per qualified event name. Entries describe the current
  // schema version and the step-wise transforms that upgrade older stored
  // payloads. Empty chain when an event has never been migrated (version=1).
  getEventUpcasters(): ReadonlyMap<
    string,
    { readonly currentVersion: number; readonly chain: ReadonlyMap<number, EventUpcastFn> }
  >;
  getExtension(name: string): RegistrarExtensionDef | undefined;
  getExtensionUsages(extensionName: string): readonly RegistrarExtensionRegistration[];
  getAllNotifications(): ReadonlyMap<string, NotificationDefinition>;
  getAllReferenceData(): readonly ReferenceDataDef[];
  // Look up projections by source-entity name. Empty list when no projection
  // feeds off the entity — event-store-executor uses this as the hot-path.
  getProjectionsForSource(entityName: string): readonly ProjectionDefinition[];
  getAllProjections(): ReadonlyMap<string, ProjectionDefinition>;

  // Multi-stream projections registered via r.multiStreamProjection().
  // Keyed by qualified name. The server wires each into the event-dispatcher
  // as its own EventConsumer with a dedicated cursor.
  getAllMultiStreamProjections(): ReadonlyMap<string, MultiStreamProjectionDefinition>;
};
