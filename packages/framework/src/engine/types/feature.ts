import type { ZodType, z } from "zod";
import type { EntityTableMeta } from "../../db/entity-table-meta";

// PgTable historically came from drizzle-orm/pg-core; the native dialect
// no longer carries drizzle internal class types. Every caller really
// needs "an opaque table-object with Symbol-based introspection".
type PgTable = unknown;

import type { QueryHandlerDefinition, WriteHandlerDefinition } from "../define-handler";
import type { RegisterEntityCrudOptions } from "../entity-handlers";
import type {
  ConfigKeyDefinition,
  ConfigKeyHandle,
  ConfigKeyType,
  ConfigSeedDef,
  ExtensionSelectorDef,
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
  DeclarativeEventMigration,
  EntityRef,
  EventDef,
  EventMigrationDef,
  EventPiiFields,
  EventUpcastFn,
  HandlerRef,
  NameOrRef,
  QualifiedEventName,
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
  OwnedFn,
  PostDeleteHookFn,
  PostQueryHookFn,
  PostSaveHookFn,
  PreDeleteHookFn,
  PreQueryHookFn,
  PreSaveHookFn,
  SearchPayloadContributorFn,
  ValidationHookFn,
} from "./hooks";
import type { HttpRouteDefinition } from "./http-route";
import type { NavDefinition } from "./nav";
import type {
  EntityProjectionExtension,
  MultiStreamProjectionDefinition,
  ProjectionDefinition,
} from "./projection";
import type { EntityRelations, RelationDefinition } from "./relations";
import type { ScreenDefinition } from "./screen";
import type { TreeActionDef, TreeActionsHandle } from "./tree-node";
import type { WorkspaceDefinition } from "./workspace";

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
  // Tenant must set this secret before the owning feature works. Surfaced
  // by readiness:query:status; keep in sync with the missing-secret throw
  // in the feature's build-fn.
  readonly required?: boolean;
};

export type SecretOptions = Omit<SecretKeyDefinition, "shortName" | "qualifiedName">;

// Typed reference returned by r.secret(). Lets feature code pass a
// strongly-named handle to ctx.secrets.get instead of retyping the
// qualified string. Parallels ConfigKeyHandle from the config system.
export type SecretKeyHandle = {
  readonly name: string;
};

// --- Raw tables (declared by features via r.rawTable()) ---

/** Options accepted by `r.rawTable()`. The `reason` is required so the
 *  bypass leaves an audit trail at the registration site — reviewers can
 *  judge legitimacy without spelunking into history, and a future cleanup
 *  pass can find candidates for migration to `r.entity()`. */
export type RawTableOptions = {
  /** Why this table needs to bypass the event-sourcing system. Examples:
   *  "imported from pre-ES system, read-only", "external Stripe webhook
   *  payload cache, write-only by webhook handler", "denormalised
   *  projection of a non-Kumiko data source". */
  readonly reason: string;
};

/** Per-feature raw-table registration. Carries the bypass-justification
 *  reason but knows nothing about the owning feature — that's added when
 *  the registry aggregates entries cross-feature into `RawTableDef`. */
export type RawTableEntry = {
  readonly name: string;
  readonly table: PgTable;
  readonly reason: string;
};

/** Registry-aggregated raw-table — the per-feature `RawTableEntry` plus
 *  the owning feature name. This is what `Registry.getAllRawTables()`
 *  exposes to readers (dev-server, ops UIs). */
export type RawTableDef = RawTableEntry & {
  readonly featureName: string;
};

// --- Unmanaged tables (declared by features via r.unmanagedTable()) ---

/** Per-feature unmanaged-table registration. `meta` is the
 *  `EntityTableMeta` (framework-native shape used by `migrate-runner`).
 *  The `reason` justifies the bypass at the registration site — same
 *  contract as `r.rawTable`. */
export type UnmanagedTableEntry = {
  readonly name: string;
  readonly meta: EntityTableMeta;
  readonly reason: string;
  readonly piiEncryptedOnWrite?: true;
};

/** Options for r.unmanagedTable(). Direct-write stores skip the executor,
 *  so the executor's PII encryption never runs for them — a feature whose
 *  meta carries piiSubjectFields must encrypt those fields itself before
 *  every insert/update and declare that here, or boot fails (#820). */
export type UnmanagedTableOptions = RawTableOptions & {
  readonly piiEncryptedOnWrite?: true;
};

/** Registry-aggregated unmanaged-table — adds the owning feature name. */
export type UnmanagedTableDef = UnmanagedTableEntry & {
  readonly featureName: string;
};

// --- UI-Hints (manifest-only, picker/scaffolder metadata) ---

// Optional, declarative UI metadata declared via `r.uiHints({...})`. Surfaces
// in feature-manifest.json under `feature.uiHints`. Consumers (the picker in
// `create-kumiko-app`, the docs feature-reference) treat absent hints as
// "no special treatment" — bare feature.name + feature.description still work.
//
// Keep this list lean. Anything that already has a home on the feature
// (configKeys.scope/default/encrypted, secretKeys, requires, etc.) lives there.
// Only add fields here that are genuinely UI-only.
// "select"/"text" variants dropped (569/1) — no bundled feature uses anything
// but "boolean" yet and the picker doesn't render them either; re-add once a
// real feature needs them.
export type UiHintOption = {
  readonly key: string;
  readonly label: string;
  readonly type: "boolean";
  readonly default: boolean;
};

export type UiHints = {
  // Picker-facing label ("Auth · Email + Password" instead of the bare
  // feature-name "auth-email-password").
  readonly displayLabel?: string;
  // Grouping for the picker. Free-form string; the picker sorts/groups by it.
  readonly category?: string;
  // Pre-checked in the picker when the user runs `bun create kumiko-app`.
  readonly recommended?: boolean;
  // Sub-options the picker asks about per-feature (e.g. "Password-Reset-Flow
  // on/off"). The scaffolder maps each key to a generator decision; the
  // framework doesn't act on them at runtime.
  readonly configurableOptions?: readonly UiHintOption[];
};

// --- Feature Definition (output of defineFeature) ---

export type FeatureDefinition = {
  readonly name: string;
  // Docs-lead paragraph declared via r.describe(). Flows through the
  // manifest introspection into the generated feature-reference pages.
  readonly description?: string;
  readonly systemScope: boolean;
  // Set from the setup-callback return — typed via `defineFeature<TExports>`.
  // `undefined` for setups that return nothing.
  readonly exports?: unknown;
  readonly requires: readonly string[];
  readonly optionalRequires: readonly string[];
  // Read-side projection-tables this feature is allowed to write via
  // r.step.unsafeProjectionUpsert / unsafeProjectionDelete. Declared via
  // r.requires.projection("table_name"). Hard requirement — boot-error
  // if a step targets a non-listed table or one that's already an
  // r.entity-registered aggregate-table. See step-vocabulary.md Q10.
  readonly requiredProjections: ReadonlySet<string>;
  // Tier-2 step kinds opted-in via r.requires.step("webhook.send"). Q9.
  readonly requiredSteps: ReadonlySet<string>;
  // Declared via r.toggleable({ default }). Presence makes the feature
  // operator-switchable via the feature-toggles bundled feature; absence
  // means the feature is always-on (e.g. auth, tenant, user — core infra
  // that would brick the system if switchable).
  readonly toggleableDefault?: boolean;
  // Declarative UI metadata for picker/scaffolder tooling. Set via r.uiHints().
  // Pure manifest-side info — the framework runtime doesn't read it.
  readonly uiHints?: UiHints;
  // entities/hooks/entityHooks are optional: defineFeature always
  // materializes them, but hand-built definitions at system boundaries
  // (test fixtures, partial boots — see registry.test.ts "slot robustness")
  // omit them and the registry guards against that. Type follows runtime.
  readonly entities?: Readonly<Record<string, EntityDefinition>>;
  // Optional backing Drizzle table per entity, declared via the third arg of
  // `r.entity(name, def, { table })`. Source of truth for the physical DDL
  // when the table carries columns/indexes the field-DSL can't express
  // (e.g. secrets' envelope jsonb without default). `collectTableMetas` and
  // the registry's implicit-projection use this object instead of the
  // field-derived table, so generate + test-push + executor share ONE table.
  readonly entityTables?: Readonly<Record<string, unknown>>;
  readonly relations: Readonly<Record<string, EntityRelations>>;
  readonly writeHandlers: Readonly<Record<string, WriteHandlerDef>>;
  readonly queryHandlers: Readonly<Record<string, QueryHandlerDef>>;
  readonly translations: TranslationKeys;
  readonly hooks?: HookMap;
  readonly entityHooks?: EntityHookMap;
  // F3 search-payload-extension — per-entity contributors that add flat fields
  // to the search-index payload during indexing. Keyed by entityName. Wrapped
  // in OwnedFn for feature-toggle filtering (consistent with postQuery-Hooks).
  readonly searchPayloadExtensions?: Readonly<
    Record<string, readonly OwnedFn<SearchPayloadContributorFn>[]>
  >;
  readonly configKeys: Readonly<Record<string, ConfigKeyDefinition>>;
  readonly configSeeds: readonly ConfigSeedDef[];
  readonly jobs: Readonly<Record<string, JobDefinition>>;
  readonly registrarExtensions: Readonly<Record<string, RegistrarExtensionDef>>;
  readonly extensionUsages: readonly RegistrarExtensionRegistration[];
  readonly extensionSelectors: readonly ExtensionSelectorDef[];
  /**
   * Cross-feature API names this feature exposes via `r.exposesApi(name)`.
   * Pure Marker-Deklaration — die echte Implementation wird als
   * Query-/Write-Handler unter dem QN-Pattern registriert (z.B.
   * `compliance-profiles:query:effective-profile`). Boot-Validator prüft
   * dass jedes `r.usesApi(name)` einen passenden Exposer hier findet —
   * Tippfehler oder Drop-Refactorings werden zu Boot-Fail statt Runtime-Crash.
   */
  readonly exposedApis: ReadonlySet<string>;
  /**
   * Cross-feature API names this feature calls. Pflicht-Boot-Check:
   * jeder Eintrag muss in `exposedApis` irgendeines Features auftauchen
   * UND das Provider-Feature muss in requires/optionalRequires sein.
   */
  readonly usedApis: ReadonlySet<string>;
  readonly referenceData: readonly ReferenceDataDef[];
  readonly notifications: Readonly<Record<string, NotificationDefinition>>;
  readonly events: Readonly<Record<string, EventDef>>;
  // Event schema migrations declared via defineEvent's `migrations` option. Keyed by event
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
  // Implicit-projection extensions declared via r.extendEntityProjection().
  // Keyed by entity name; merged into that entity's implicit projection at
  // registry build so rebuildProjection replays the extension's events.
  readonly entityProjectionExtensions?: Readonly<
    Record<string, readonly EntityProjectionExtension[]>
  >;
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
  // Nav entries declared via r.nav(). Keyed by the feature-local short id;
  // registry qualifies to "<feature>:nav:<id>". Flat list — the renderer's
  // resolveNavigation assembles the tree from parent refs at mount time.
  readonly navs: Readonly<Record<string, NavDefinition>>;
  // Workspaces declared via r.workspace(). Keyed by feature-local short id;
  // registry qualifies to "<feature>:workspace:<id>". Pure UI metadata —
  // shellWorkspaces consumes the resolved per-workspace nav list at mount
  // time; engine validates roles + nav refs at boot.
  readonly workspaces: Readonly<Record<string, WorkspaceDefinition>>;
  // Tree-Actions-Map declared via r.treeActions(). At-most-one per feature
  // (only-once-guard at registration). Erased to `Record<string,
  // TreeActionDef>` for runtime registry-lookup (Visual-Tree-Component
  // dispatching, Pattern-AST consumers). The compile-time-typed surface
  // is the registrar's return value (TreeActionsHandle) which the
  // feature exports via setup-return — buildTarget consumes the handle,
  // not this slot. See visual-tree.md A5 + A7.
  readonly treeActions?: Readonly<Record<string, TreeActionDef>>;
  // HTTP-Routes declared via r.httpRoute(). Index is "METHOD path"
  // (z.B. "GET /feed.xml") — eindeutig pro Feature. Die App-Server-
  // Boot-Stage iteriert getAllHttpRoutes() und mountet jede Route auf
  // den Hono-app (außerhalb /api/*). Pattern symmetrisch zu queryHandlers/
  // writeHandlers — Routes leben mit dem Feature, nicht im Bootstrap.
  readonly httpRoutes: Readonly<Record<string, HttpRouteDefinition>>;
  // Raw tables declared via r.rawTable() — bypass the event-sourcing
  // system. Keyed by feature-local short name. The registry attaches
  // featureName on aggregation, lifting RawTableEntry → RawTableDef.
  readonly rawTables: Readonly<Record<string, RawTableEntry>>;
  // Unmanaged tables declared via r.unmanagedTable() — `EntityTableMeta`
  // shape (post-drizzle), keyed by feature-local table-name. Cousin of
  // rawTables: same bypass-justification contract, different storage
  // shape. `kumiko schema generate` aggregates these alongside
  // r.entity()-derived metas to build the full schema.
  readonly unmanagedTables: Readonly<Record<string, UnmanagedTableEntry>>;
  // Optional Zod-schema for env-vars this feature reads at runtime.
  // Declared via `r.envSchema(z.object({...}))`. `composeEnvSchema` reads
  // this to build one app-wide schema for boot-validation + dry-run
  // rendering. Absence means the feature reads no env-vars (or hasn't
  // been migrated yet — Sprint-9 migration is add-only per phase).
  readonly envSchema?: z.ZodObject<z.ZodRawShape>;
};

// --- Feature Registrar (the "r" object in defineFeature) ---

type RefOrRefs = NameOrRef | readonly NameOrRef[];
// Entity-wide hook target — "all query/write handlers of this entity",
// same reach r.entityHook() used to have. Only valid for postSave/
// preDelete/postDelete/postQuery (the same 4 types entityHook covered);
// hook() throws at registration time if used with validation/preSave/
// preQuery.
type HookTarget = RefOrRefs | { readonly allOf: NameOrRef };

/**
 * `TFeature` is the literal feature-name from `defineFeature("foo", ...)` —
 * default-`string` keeps every existing usage zero-config. Strict-typed
 * features (apps that opt into the literal-name flavour) get propagated
 * through to `defineEvent` so the returned `EventDef.name` is a literal
 * `${CamelToKebab<TFeature>}:event:${CamelToKebab<TInner>}`. That literal
 * threads through `ctx.appendEvent({ type: eventDef.name, ... })`,
 * keeping strict-mode alive even when handlers route via `eventDef.name`
 * instead of hand-typed string literals.
 */
/**
 * `r.requires` is a callable+namespace: existing call form takes feature
 * names (`r.requires("auth", "tenant")`), the `.projection` extension
 * declares read-side projection tables that this feature's pipeline
 * steps are allowed to write via `r.step.unsafeProjectionUpsert`.
 * Hard-required for any unsafeProjection-* step usage (see Q10).
 */
export type RequiresApi = ((...featureNames: string[]) => void) & {
  readonly projection: (tableName: string) => void;
  // Tier-2 step opt-in (Q9). Tier-1 implicit, Tier-2 must be declared.
  readonly step: (stepKind: string) => void;
};

export type FeatureRegistrar<TFeature extends string = string> = {
  systemScope(): void;
  // One-to-three-sentence docs-lead for the feature ("what it does + when
  // you need it"). At most once per feature; must be non-empty.
  describe(text: string): void;
  requires: RequiresApi;
  optionalRequires(...featureNames: string[]): void;
  // Declare the feature as operator-togglable. `default` is the effective
  // state when no global-toggle row exists. Must be called at most once per
  // feature; calling on an always-on feature (e.g. auth/tenant/user) is a
  // bug — and one nothing catches at boot, so don't.
  toggleable(options: { default: boolean }): void;
  // Picker/scaffolder metadata — see UiHints. At most once per feature.
  uiHints(hints: UiHints): void;

  entity(
    name: string,
    definition: EntityDefinition,
    options?: { readonly table?: unknown },
  ): EntityRef;

  // One-call CRUD for an event-sourced entity — delegates to registerEntityCrud():
  // r.entity + create/update/delete/restore/list/detail handlers per verb flag.
  // Access stays explicit — no openToAll default.
  crud(name: string, definition: EntityDefinition, options?: RegisterEntityCrudOptions): EntityRef;

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
  // postSave/preDelete/postDelete/postQuery accept `{ allOf: entityRef }` —
  // fires for every write/query handler of that entity, replacing the old
  // r.entityHook(type, entity, fn). postQuery's entity-wide form fires for
  // ALL query-handlers of the entity (e.g. customFields-bundle merging
  // custom-fields-jsonb into every read); no phase semantics there
  // (synchronous after handler-execute, before field-access-filter).
  hook(
    type: "postSave",
    target: HookTarget,
    fn: PostSaveHookFn,
    options?: { phase?: HookPhase },
  ): void;
  // preDelete always runs in-transaction (it guards the delete — there is no
  // meaningful "after" for a pre-hook). No phase option.
  hook(type: "preDelete", target: HookTarget, fn: PreDeleteHookFn): void;
  hook(
    type: "postDelete",
    target: HookTarget,
    fn: PostDeleteHookFn,
    options?: { phase?: HookPhase },
  ): void;
  hook(type: "preQuery", target: RefOrRefs, fn: PreQueryHookFn): void;
  hook(type: "postQuery", target: HookTarget, fn: PostQueryHookFn): void;

  // F3 — Search-Payload-Extension: contributor function adds flat fields to
  // an entity's search-index document. Fires synchronously during
  // buildSearchDocument indexing. Use-case: custom-fields-bundle merging
  // customFields-jsonb-keys flat into search-doc; tags-bundle projecting
  // tags-array as searchable. See `SearchPayloadContributorFn`.
  searchPayloadExtension(entity: NameOrRef, fn: SearchPayloadContributorFn): void;

  // Single-key form: bare handle, no wrapping record, no seeds (callers
  // needing seeds use the multi-key form below).
  config<T extends ConfigKeyType>(keyName: string, def: ConfigKeyDefinition<T>): ConfigKeyHandle<T>;

  // Multi-key form: returns a handle map keyed exactly like the input. Pass
  // any handle to `ctx.config(handle)` to get the value type narrowed by the
  // key's `type`. Optional `seeds` declare boot-time system-rows that are
  // written via the event-store executor — idempotent, skipped when the
  // stream already exists.
  config<TKeys extends Readonly<Record<string, ConfigKeyDefinition<ConfigKeyType>>>>(definition: {
    readonly keys: TKeys;
    readonly seeds?: Readonly<Record<string, ConfigSeedDef>>;
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
  // on first registration. When you bump the payload shape, add a step to
  // `options.migrations` covering N -> N+1 — the framework refuses to boot
  // if the chain from 1 to `version` has gaps. Migrations were formerly a
  // separate r.eventMigration() call; folded in here because an event and
  // its schema evolution are one lifecycle, not two registrar concepts
  // (#1082 step 8) — transforms are pure functions (old payload in, new
  // payload out) and run once per read, not once per event persisted, so
  // keep them cheap.
  //
  // `options.piiFields` declares PII payload fields encrypted under the DEK
  // of the user named by `subjectField` (crypto-shredding, #799). append()
  // enforces the catalog on every write path.
  defineEvent<const TInner extends string, TPayload>(
    name: TInner,
    schema: ZodType<TPayload>,
    options?: {
      readonly version?: number;
      readonly piiFields?: EventPiiFields;
      readonly migrations?: readonly {
        readonly fromVersion: number;
        readonly toVersion: number;
        readonly transform: EventUpcastFn | DeclarativeEventMigration;
      }[];
    },
  ): EventDef<TPayload, QualifiedEventName<TFeature, TInner>>;

  readsConfig(...qualifiedKeys: string[]): void;

  referenceData(
    entity: NameOrRef,
    data: readonly Record<string, unknown>[],
    options?: { upsertKey?: string },
  ): void;

  extendsRegistrar(name: string, def: RegistrarExtensionDef): void;

  useExtension(extensionName: string, entity: NameOrRef, options?: Record<string, unknown>): void;

  /**
   * Declares which config key selects the active provider under an
   * extension point — called by the point-owning foundation (e.g.
   * `r.extensionSelector("mailTransport", configKeys.provider)`).
   * Readiness gating counts a provider-feature's `required` keys and
   * secrets only while that provider is the selected one. Registry-build
   * fails on duplicate declarations per extension and on selector keys
   * that no mounted feature declares.
   */
  extensionSelector(extensionName: string, key: { readonly name: string } | string): void;

  /**
   * Marker-Deklaration: dieses Feature stellt eine Cross-Feature-API
   * unter dem genannten Namen bereit. Die eigentliche Implementation
   * wird separat als Query- oder Write-Handler unter dem QN-Pattern
   * registriert; `r.exposesApi` ist reine Boot-Check-Surface.
   *
   * Boot-Validator prüft, dass jedes `r.usesApi(name)` einen passenden
   * Exposer findet, dass das Exposer-Feature in requires/optionalRequires
   * gelisted ist und dass kein API-Name doppelt exposed wird.
   *
   * ```ts
   * defineFeature("compliance-profiles", (r) => {
   *   r.exposesApi("compliance.forTenant");
   *   r.queryHandler({
   *     name: "compliance:query:for-tenant",
   *     // ... echte Implementation
   *   });
   * });
   * ```
   */
  exposesApi(apiName: string): void;

  /**
   * Declares that this feature calls a cross-feature API. Boot-Validator
   * checkt dass irgendein anderes Feature `r.exposesApi(apiName)` macht
   * und dass dieses Feature `r.requires/optionalRequires` darauf hat.
   *
   * ```ts
   * defineFeature("user-data-rights", (r) => {
   *   r.requires("compliance-profiles");
   *   r.usesApi("compliance.forTenant");
   * });
   * ```
   */
  usesApi(apiName: string): void;

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

  // Merge extra apply handlers (+ extra event sources) into an entity's
  // implicit projection so rebuildProjection replays event types a bundled
  // extension materializes into the HOST entity's table (custom-fields
  // pattern). Rebuild-only: the inline runner skips implicit projections —
  // live delivery stays with the extension's own MSP. The entity must be
  // declared via r.entity in the SAME feature; unknown entities and
  // apply-key collisions fail at registry build.
  extendEntityProjection(entityName: string, extension: EntityProjectionExtension): void;

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

  // Declare a claim key. Qualified name follows "<feature>:<shortName>" —
  // NO kebab conversion (it would break the claim round-trip, unlike
  // r.secret / r.config). Returns a
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
  // validation (r.uiComponent) comes in M4/M5. Optional `nav` field is
  // sugar for a single nav entry pointing at this screen — equivalent to
  // a standalone r.nav({ id: <same id>, screen: "<feature>:screen:<id>", ... }).
  screen(definition: ScreenDefinition): void;

  // Register a nav entry. The id is the feature-local short name (kebab-case);
  // the registry qualifies to "<feature>:nav:<id>". Boot-validation checks
  // that `screen` and `parent` refs exist (cross-feature QNs allowed) and
  // that parent chains don't contain cycles.
  nav(definition: NavDefinition): void;

  // Register a workspace — a persona-/role-scoped UI surface. Pure UI
  // composition; the registry qualifies the short id to
  // "<feature>:workspace:<id>". Boot-validation checks that any nav refs
  // exist, that workspace ids referenced from r.nav() are real, and that
  // at most one workspace per app declares `default: true`.
  workspace(definition: WorkspaceDefinition): void;

  // Register an HTTP-route owned by this feature. The route is mounted
  // outside the dispatcher pipeline (= außerhalb /api/write|query|batch),
  // direkt an die app — Use-Case: RSS/Atom-Feeds, OG-Images, OpenAPI-Specs.
  // Duplicate "method path"-Combinations are rejected per feature at setup
  // time; there is no cross-feature check.
  // Symmetric to queryHandler/writeHandler — Routes leben mit dem Feature,
  // nicht im Bootstrap. Escape-hatch für nicht-feature-bound Routes
  // bleibt runProdApp.extraRoutes.
  httpRoute(definition: HttpRouteDefinition): void;

  // Declare a raw Drizzle table that bypasses the event-sourcing system.
  // Reserved for legacy-import, read-only caches, write-only webhook
  // payload buffers, or any other case where the event-sourced flow
  // doesn't fit. The dev-server iterates these alongside r.entity()
  // projections at boot so the table exists before the first query.
  // Apps still declare the table in `drizzle/schema.ts` so drizzle-kit
  // tracks migrations and schema-drift detection works automatically.
  //
  // The required `reason` string is the marker that justifies the bypass —
  // a non-empty string is the contract. If you can't write a reason,
  // declare data via `r.entity()` instead.
  rawTable(name: string, table: PgTable, options: RawTableOptions): void;

  // Declare an "unmanaged" framework-native table (post-drizzle).
  // EntityTableMeta carries the same column-shape that r.entity() builds,
  // minus the audit-trail + base-columns scaffolding — used for read-side
  // projections of event-streams (delivery-attempts, job-run-logs) where
  // r.entity()'s aggregate-lifecycle assumptions don't fit.
  //
  // The `meta` argument is the result of `defineUnmanagedTable(...)` from
  // `@cosmicdrift/kumiko-framework/db`. Reason-justification + audit-trail
  // contract identical to `r.rawTable`.
  //
  // Why this exists separate from `r.rawTable`: rawTable carries a Drizzle
  // `PgTable` (legacy), unmanagedTable carries the new `EntityTableMeta`
  // shape that `migrate-runner` consumes. After the full drizzle-cut they
  // will likely merge; for now they coexist.
  unmanagedTable(meta: EntityTableMeta, options: UnmanagedTableOptions): void;

  // Register the tree-actions schema for this feature — a map of
  // action-name → action-definition (with optional typed args). At-most-
  // one call per feature.
  //
  // Returns a TreeActionsHandle that the feature exports via setup-return
  // (Memory `[EventDef-Exports-Pattern]`). The handle carries the
  // literal-typed action-map that `buildTarget` consumes for compile-
  // time validation:
  //
  //   const handle = r.treeActions({
  //     edit: { args: { slug: "" as string } },
  //     list: {},
  //   });
  //   return { handle };
  //
  // Without this typed return, the action-map collapses to
  // `Record<string, TreeActionDef>` at the buildTarget call-site and
  // every action becomes accept-anything-string. See visual-tree.md A5.
  //
  // The runtime FeatureDefinition.treeActions slot stores the same map
  // as erased Record (registry lookup, Pattern-AST consumers).
  treeActions<const TActions extends Record<string, TreeActionDef>>(
    actions: TActions,
  ): TreeActionsHandle<TFeature, TActions>;

  // Declare the Zod-schema for env-vars this feature reads at runtime.
  // At-most-one call per feature. composeEnvSchema reads it across all
  // features to build one app-wide schema, which runProdApp parses
  // process.env against at boot. App-Authors can also call
  // `KUMIKO_DRY_RUN_ENV=human|json|pulumi|k8s` to introspect the
  // required env-vars without booting.
  //
  // Convention: keys are SHOUTING_SNAKE_CASE env-var names. Per-var
  // metadata (Pulumi-config-key override, openssl-generator suggestion,
  // k8s-secret hints) goes into `.meta({ kumiko: { pulumi: {...} } })`
  // — see framework/env/index.ts for the meta-shape.
  envSchema(schema: z.ZodObject<z.ZodRawShape>): void;
};

// --- Registry (created from features) ---

export type Registry = {
  readonly features: ReadonlyMap<string, FeatureDefinition>;

  getFeature(name: string): FeatureDefinition | undefined;
  getEntity(name: string): EntityDefinition | undefined;
  getAllEntities(): ReadonlyMap<string, EntityDefinition>;
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
  getPostQueryHooks(
    name: string,
    effectiveFeatures?: ReadonlySet<string>,
  ): readonly PostQueryHookFn[];
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
  getEntityPostQueryHooks(
    entityName: string,
    effectiveFeatures?: ReadonlySet<string>,
  ): readonly PostQueryHookFn[];
  // F3 — contributors for an entity's search-doc-payload, fired during
  // buildSearchDocument indexing. See `SearchPayloadContributorFn`.
  // `effectiveFeatures` filters out contributors owned by feature-toggle-
  // disabled features (parallel to other getters' filtering semantic).
  getSearchPayloadExtensions(
    entityName: string,
    effectiveFeatures?: ReadonlySet<string>,
  ): readonly SearchPayloadContributorFn[];
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
  getAllConfigSeeds(): readonly ConfigSeedDef[];
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
  // Extension point → selector config key, from r.extensionSelector calls.
  getAllExtensionSelectors(): ReadonlyMap<string, string>;
  getAllNotifications(): ReadonlyMap<string, NotificationDefinition>;
  getAllReferenceData(): readonly ReferenceDataDef[];
  // Look up projections by source-entity name. Empty list when no projection
  // feeds off the entity — event-store-executor uses this as the hot-path.
  getProjectionsForSource(entityName: string): readonly ProjectionDefinition[];
  getAllProjections(): ReadonlyMap<string, ProjectionDefinition>;

  // All r.rawTable() registrations across all features, keyed by
  // feature-local short name. The dev-server iterates this alongside
  // implicit projections at boot. Cross-feature uniqueness is enforced
  // at registry-build — duplicate names from different features fail
  // the boot, so callers can rely on a flat keyspace.
  getAllRawTables(): ReadonlyMap<string, RawTableDef>;

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
  // All entity-bound screens (entityList / entityEdit) that target the given
  // entity. Pre-grouped so ui-core's view-model builders don't re-filter
  // getAllScreens() on every render. Custom screens have no entity and are
  // never returned here — walk getAllScreens() for those.
  getScreensByEntity(entityName: string): readonly ScreenDefinition[];

  // Nav entries declared via r.nav() across all features. Keyed by qualified
  // name ("<feature>:nav:<id>"). Flat list — the renderer's resolveNavigation
  // assembles the tree from parent refs and gates by effective-features.
  getAllNavs(): ReadonlyMap<string, NavDefinition>;
  getNav(qualifiedName: string): NavDefinition | undefined;
  // The feature that registered the given nav entry. Used by the nav
  // resolver to drop entries whose owning feature is globally disabled.
  getNavFeature(qualifiedName: string): string | undefined;
  // Direct children of the given parent nav entry. Empty array when the
  // parent has no children. Pre-grouped for O(1) tree-walk — resolveNavigation
  // recurses with getNavsByParent(child.qn) instead of filtering getAllNavs().
  getNavsByParent(parentQualifiedName: string): readonly NavDefinition[];
  // Nav entries that declare no parent — the roots of the navigation tree.
  // resolveNavigation starts its walk here and descends via getNavsByParent.
  getTopLevelNavs(): readonly NavDefinition[];

  // Workspaces declared via r.workspace() across all features. Keyed by
  // qualified name ("<feature>:workspace:<id>"). The active web shell
  // (shellWorkspaces) consumes this to render the switcher.
  getAllWorkspaces(): ReadonlyMap<string, WorkspaceDefinition>;
  getWorkspace(qualifiedName: string): WorkspaceDefinition | undefined;
  // The feature that registered the workspace. Mirrors getNavFeature —
  // lets the resolver drop workspaces whose owning feature is disabled.
  getWorkspaceFeature(qualifiedName: string): string | undefined;
  // Resolved nav QNs that belong to the given workspace. Pre-computed at
  // boot from BOTH r.workspace.nav AND r.nav.workspaces — the shell
  // doesn't have to merge sources at render time.
  getWorkspaceNavs(workspaceQualifiedName: string): readonly string[];
  // The single workspace whose `default: true` is set, if any. Boot
  // validator rejects more than one. Apps without a default fall back to
  // the first workspace the user has access to.
  getDefaultWorkspace(): WorkspaceDefinition | undefined;

  // Tree-Actions-Map des Features. Returns the erased Record (compile-
  // time-typed handle wandert über setup-export, nicht hier). Die
  // Content-Tree-Nav nutzt das für Runtime-Action-Lookup beim Klick auf
  // einen TreeNode.target — der Resolver findet das Feature via
  // TargetRef.featureId und holt sich die zugehörige Action-Definition.
  getTreeActions(featureName: string): Readonly<Record<string, TreeActionDef>> | undefined;
};
