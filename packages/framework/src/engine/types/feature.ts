import type { ZodType, z } from "zod";
import type { QueryHandlerDefinition, WriteHandlerDefinition } from "../define-handler";
import type {
  ConfigKeyDefinition,
  ConfigKeyHandle,
  ConfigKeyType,
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
  AuthClaimsFn,
  AuthClaimsHookDef,
  ClaimKeyDefinition,
  ClaimKeyHandle,
  ClaimKeyType,
  EntityRef,
  EventDef,
  EventMigrationDef,
  EventUpcastFn,
  HandlerRef,
  NameOrRef,
  QueryHandlerDef,
  QueryHandlerFn,
  RateLimitOption,
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
import type { ScreenDefinition } from "./screen";

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

// --- Secret Keys (declared by features via r.secret()) ---

// A feature-declared secret. The fully-qualified name is
// `<featureName>:<shortName>` — the Framework prefixes. Ops see the
// qualified name in list / audit; feature code reads it via
// ctx.secrets.get(tenantId, SecretKeys.stripeKey) with the typed handle.
export type SecretKeyDefinition = {
  // Short name inside the feature (e.g. "stripe.apiKey"). Qualified to
  // `<feature>:<shortName>` at registry-build time.
  readonly shortName: string;
  // Qualified name — `<feature>:<shortName>`. Set during registry build.
  readonly qualifiedName: string;
  // i18n label for TenantAdmin UI.
  readonly label: { readonly [locale: string]: string };
  // Optional redaction function. Takes the plaintext, returns the preview
  // shown in list handlers. Default is first-3-chars + bullets.
  readonly redact?: (plaintext: string) => string;
  // Short human hint shown in UI ("Find this in your Stripe dashboard ...").
  readonly hint?: { readonly [locale: string]: string };
  // Per-secret scope. v1 only "tenant" — user / system scopes ship in v2.
  readonly scope: "tenant";
};

export type SecretOptions = Omit<SecretKeyDefinition, "shortName" | "qualifiedName">;

// Typed reference returned by r.secret(). Lets feature code pass a
// strongly-named handle to ctx.secrets.get instead of retyping the
// qualified string. Parallels ConfigKeyHandle from the config system.
export type SecretKeyHandle = {
  readonly name: string;
};

// --- Feature Definition (output of defineFeature) ---

export type FeatureDefinition = {
  readonly name: string;
  readonly systemScope: boolean;
  // Set from the setup-callback return — typed via `defineFeature<TExports>`.
  // `undefined` for setups that return nothing.
  readonly exports?: unknown;
  readonly requires: readonly string[];
  readonly optionalRequires: readonly string[];
  // Declared via r.toggleable({ default }). Presence makes the feature
  // operator-switchable via the feature-toggles bundled feature; absence
  // means the feature is always-on (e.g. auth, tenant, user — core infra
  // that would brick the system if switchable).
  readonly toggleableDefault?: boolean;
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
  // Handler → entity mapping inferred from the colon convention
  // ("entityName:verb") via tryMapEntity in defineFeature.
  readonly handlerEntityMappings: Readonly<Record<string, string>>;
  // Metrics declared via r.metric(). Short names — Framework prefixes on boot.
  readonly metrics: Readonly<Record<string, FeatureMetricDef>>;
  // Secret keys declared via r.secret(). Short names — Framework prefixes to
  // "<feature>:<short>" during registry build.
  readonly secretKeys: Readonly<Record<string, SecretKeyDefinition>>;
  // Projections declared via r.projection(). Keyed by projection name; executor
  // looks them up by source-entity at write-time.
  readonly projections: Readonly<Record<string, ProjectionDefinition>>;
  // Multi-stream projections — cross-aggregate async read-models. Keyed by
  // short name; the dispatcher wraps each into an EventConsumer with its
  // own cursor.
  readonly multiStreamProjections: Readonly<Record<string, MultiStreamProjectionDefinition>>;
  // Auth-claims hooks declared via r.authClaims(). Executed at login (and
  // switch-tenant) time; their returned records are merged into
  // SessionUser.claims under the auto-prefix "<featureName>:<key>".
  readonly authClaimsHooks: readonly AuthClaimsFn[];
  // Declared claim keys via r.claimKey(). Shorts keyed by their JS-side
  // short name, qualified name qualified at registration time.
  readonly claimKeys: Readonly<Record<string, ClaimKeyDefinition>>;
  // Screen definitions declared via r.screen(). Keyed by the feature-local
  // short id; the registry qualifies to "<feature>:screen:<id>" on boot.
  // Pure data — ui-core + renderer packages interpret; engine only stores
  // and validates entity/field references against the feature's entities.
  readonly screens: Readonly<Record<string, ScreenDefinition>>;
};

// --- Feature Registrar (the "r" object in defineFeature) ---

type RefOrRefs = NameOrRef | readonly NameOrRef[];

export type FeatureRegistrar = {
  systemScope(): void;
  requires(...featureNames: string[]): void;
  optionalRequires(...featureNames: string[]): void;
  // Declare the feature as operator-togglable. `default` is the effective
  // state when no global-toggle row exists. Must be called at most once per
  // feature; calling on an always-on feature (e.g. auth/tenant/user) is a
  // bug the registry catches at boot.
  toggleable(options: { default: boolean }): void;

  entity(name: string, definition: EntityDefinition): EntityRef;

  writeHandler<TName extends string, TSchema extends ZodType>(
    def: WriteHandlerDefinition<TName, TSchema>,
  ): HandlerRef;
  writeHandler<TSchema extends ZodType>(
    name: string,
    schema: TSchema,
    handler: WriteHandlerFn<z.infer<TSchema>>,
    options?: { access?: AccessRule; rateLimit?: RateLimitOption },
  ): HandlerRef;

  queryHandler<TName extends string, TSchema extends ZodType>(
    def: QueryHandlerDefinition<TName, TSchema>,
  ): HandlerRef;
  queryHandler<TSchema extends ZodType>(
    name: string,
    schema: TSchema,
    handler: QueryHandlerFn<z.infer<TSchema>>,
    options?: { access?: AccessRule; rateLimit?: RateLimitOption },
  ): HandlerRef;

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

  // Returns a handle map keyed exactly like the input. Pass any handle to
  // `ctx.config(handle)` to get the value type narrowed by the key's `type`.
  config<TKeys extends Readonly<Record<string, ConfigKeyDefinition<ConfigKeyType>>>>(definition: {
    readonly keys: TKeys;
  }): { readonly [K in keyof TKeys]: ConfigKeyHandle<TKeys[K]["type"]> };

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

  // Declare a secret key. Qualified name follows "<feature>:secret:<kebab>"
  // via the QN helper. Returns a typed handle so feature code can pass it
  // to ctx.secrets.get without retyping the qualified string — same
  // ergonomics as r.config's handle.
  secret(shortName: string, options: SecretOptions): SecretKeyHandle;

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

  // Register a function that contributes claims into SessionUser.claims at
  // login time. Multiple features (and multiple calls within one feature)
  // are allowed; returns are merged. Keys are auto-prefixed with the feature
  // name ("<feature>:<key>") — cross-feature collisions are impossible by
  // construction. Same-feature duplicate keys follow last-wins.
  //
  // Hooks run in parallel. If one throws, the error is logged and that
  // feature's claims are simply missing from the merged record — login
  // still succeeds. This is a deliberate best-effort policy: identity-facts
  // are convenience, not access-gates (that's what `roles` + field-access
  // rules are for).
  authClaims(fn: AuthClaimsFn): void;

  // Declare a claim key. Qualified name follows "<feature>:<kebab-short>"
  // via the QN helper — same convention as r.secret / r.config. Returns a
  // typed handle so feature code can pass it to `readClaim(user, handle)`
  // without retyping the qualified string and with the right narrowed
  // return type.
  //
  // Declaring claim keys also turns on a runtime check: when the feature's
  // r.authClaims hooks return an inner-key not in the declared list, the
  // resolver logs a warning (the claim still lands in the JWT — declared
  // or not — so strict-mode isn't on; this is typo-drift protection).
  claimKey<T extends ClaimKeyType>(
    shortName: string,
    options: { readonly type: T },
  ): ClaimKeyHandle<T>;

  // Register a screen. The id is the feature-local short name (kebab-case);
  // the registry qualifies to "<feature>:screen:<id>". Boot-validation checks
  // that entity-bound screens reference a registered entity and that the
  // columns / form-field refs name real fields — cross-feature component-QN
  // validation (r.uiComponent) comes in M4/M5.
  screen(definition: ScreenDefinition): void;
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
  // Hook getters — pass `effectiveFeatures` to drop hooks registered by
  // globally-disabled features. Omit the arg to get all hooks (legacy
  // callers + places where the feature-toggles feature isn't wired).
  getPreSaveHooks(name: string, effectiveFeatures?: ReadonlySet<string>): readonly PreSaveHookFn[];
  getPostSaveHooks(
    name: string,
    phase?: HookPhase,
    effectiveFeatures?: ReadonlySet<string>,
  ): readonly PostSaveHookFn[];
  getPreDeleteHooks(
    name: string,
    phase?: HookPhase,
    effectiveFeatures?: ReadonlySet<string>,
  ): readonly PreDeleteHookFn[];
  getPostDeleteHooks(
    name: string,
    phase?: HookPhase,
    effectiveFeatures?: ReadonlySet<string>,
  ): readonly PostDeleteHookFn[];
  getPreQueryHooks(
    name: string,
    effectiveFeatures?: ReadonlySet<string>,
  ): readonly PreQueryHookFn[];
  getEntityPostSaveHooks(
    entityName: string,
    phase?: HookPhase,
    effectiveFeatures?: ReadonlySet<string>,
  ): readonly PostSaveHookFn[];
  getEntityPreDeleteHooks(
    entityName: string,
    phase?: HookPhase,
    effectiveFeatures?: ReadonlySet<string>,
  ): readonly PreDeleteHookFn[];
  getEntityPostDeleteHooks(
    entityName: string,
    phase?: HookPhase,
    effectiveFeatures?: ReadonlySet<string>,
  ): readonly PostDeleteHookFn[];
  getHandlerEntity(qualifiedHandler: string): string | undefined;
  isHandlerSystemScoped(qualifiedHandler: string): boolean;
  getHandlerFeature(qualifiedHandler: string): string | undefined;
  // True iff at least one registered handler declares a `rateLimit`
  // option. Pre-computed at registry-build so the boot path can skip
  // wiring the RateLimitResolver (and its Lua-script registration on
  // Redis) entirely when nobody opted in. Per-request cost stays zero
  // for apps that don't use the feature.
  hasRateLimitedHandler(): boolean;
  // All metrics from all features, keyed by fully-qualified name
  // (kumiko_<feature>_<shortName>). Consumed at boot to register them on the
  // active Meter.
  getAllMetrics(): ReadonlyMap<string, FeatureMetricDef & { readonly featureName: string }>;
  getAllTranslations(): TranslationKeys;
  getConfigKey(qualifiedKey: string): ConfigKeyDefinition | undefined;
  getAllConfigKeys(): ReadonlyMap<string, ConfigKeyDefinition>;
  // Feature-declared secrets, aggregated across all registered features.
  // Keyed by qualified name ("<feature>:<shortName>"). Used by the rotation
  // job (to iterate "known" secrets) and admin-UIs to list available keys.
  getAllSecretKeys(): ReadonlyMap<string, SecretKeyDefinition>;
  getSecretKey(qualifiedName: string): SecretKeyDefinition | undefined;
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
  // The feature that registered the given MSP. Used by the event-dispatcher
  // to pause MSP-consumers whose owning feature is globally disabled.
  getMultiStreamProjectionFeature(qualifiedName: string): string | undefined;

  // All r.authClaims() hooks across all features, tagged with the declaring
  // feature name so the resolver can apply the auto-prefix. Pre-aggregated
  // at registry-build so the login hot path is a single Map read.
  getAuthClaimsHooks(): readonly AuthClaimsHookDef[];

  // Feature-declared claim keys, aggregated across all features. Keyed by
  // qualified name ("<feature>:<short>"). Ops-UI + Boot-Validator use this
  // to introspect what claims the app can produce.
  getAllClaimKeys(): ReadonlyMap<string, ClaimKeyDefinition>;
  getClaimKey(qualifiedName: string): ClaimKeyDefinition | undefined;

  // Screens declared via r.screen() across all features. Keyed by qualified
  // name ("<feature>:screen:<id>"). ui-core / renderer consume this to build
  // navigation + screen-tree at mount time.
  getAllScreens(): ReadonlyMap<string, ScreenDefinition>;
  getScreen(qualifiedName: string): ScreenDefinition | undefined;
  // The feature that registered the given screen. Consumed by the nav
  // resolver to gate a nav-entry whose screen belongs to a disabled feature.
  getScreenFeature(qualifiedName: string): string | undefined;
};
