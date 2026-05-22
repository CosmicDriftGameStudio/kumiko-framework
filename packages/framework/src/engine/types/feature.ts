import type { PgTable } from "drizzle-orm/pg-core";
import type { ZodType, z } from "zod";
import type { QueryHandlerDefinition, WriteHandlerDefinition } from "../define-handler";
import type {
  ConfigKeyDefinition,
  ConfigKeyHandle,
  ConfigKeyType,
  ConfigSeedDef,
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
import type { MultiStreamProjectionDefinition, ProjectionDefinition } from "./projection";
import type { EntityRelations, RelationDefinition } from "./relations";
import type { ScreenDefinition } from "./screen";
import type { TreeActionDef, TreeActionsHandle, TreeChildrenSubscribe } from "./tree-node";
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

// --- Feature Definition (output of defineFeature) ---

export type FeatureDefinition = {
  readonly name: string;
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
  readonly entities: Readonly<Record<string, EntityDefinition>>;
  readonly relations: Readonly<Record<string, EntityRelations>>;
  readonly writeHandlers: Readonly<Record<string, WriteHandlerDef>>;
  readonly queryHandlers: Readonly<Record<string, QueryHandlerDef>>;
  readonly translations: TranslationKeys;
  readonly hooks: HookMap;
  readonly entityHooks: EntityHookMap;
  // F3 search-payload-extension — per-entity contributors that add flat fields
  // to the search-index payload during indexing. Keyed by entityName. Wrapped
  // in OwnedFn for feature-toggle filtering (consistent with postQuery-Hooks).
  readonly searchPayloadExtensions: Readonly<
    Record<string, readonly OwnedFn<SearchPayloadContributorFn>[]>
  >;
  readonly configKeys: Readonly<Record<string, ConfigKeyDefinition>>;
  readonly configSeeds: readonly ConfigSeedDef[];
  readonly jobs: Readonly<Record<string, JobDefinition>>;
  readonly registrarExtensions: Readonly<Record<string, RegistrarExtensionDef>>;
  readonly extensionUsages: readonly RegistrarExtensionRegistration[];
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
  // Tree-Provider declared via r.tree(). At-most-one per feature.
  // Provider liefert die Top-Level-Knoten dieses Features im Visual-
  // Workspace (navigation: "tree"). Subscribe-Form mit lazy-Eval: erst
  // beim Mount des Workspaces aufgerufen, kann Updates emittieren.
  // Feature ohne treeProvider ist im Visual-Workspace unsichtbar
  // (Zero-Whitelist-Filter aus visual-tree.md A2).
  readonly treeProvider?: TreeChildrenSubscribe;
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
  // Optional Zod-schema for env-vars this feature reads at runtime.
  // Declared via `r.envSchema(z.object({...}))`. `composeEnvSchema` reads
  // this to build one app-wide schema for boot-validation + dry-run
  // rendering. Absence means the feature reads no env-vars (or hasn't
  // been migrated yet — Sprint-9 migration is add-only per phase).
  readonly envSchema?: z.ZodObject<z.ZodRawShape>;
};

// --- Feature Registrar (the "r" object in defineFeature) ---

type RefOrRefs = NameOrRef | readonly NameOrRef[];

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
  requires: RequiresApi;
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
  hook(type: "postQuery", target: RefOrRefs, fn: PostQueryHookFn): void;

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
  // postQuery-entityHook: fires for ALL query-handlers of this entity (e.g.,
  // for customFields-bundle to merge custom-fields-jsonb into every read).
  // No phase semantics (synchronous after handler-execute, before field-
  // access-filter).
  entityHook(type: "postQuery", entity: NameOrRef, fn: PostQueryHookFn): void;

  // F3 — Search-Payload-Extension: contributor function adds flat fields to
  // an entity's search-index document. Fires synchronously during
  // buildSearchDocument indexing. Use-case: custom-fields-bundle merging
  // customFields-jsonb-keys flat into search-doc; tags-bundle projecting
  // tags-array as searchable. See `SearchPayloadContributorFn`.
  searchPayloadExtension(entity: NameOrRef, fn: SearchPayloadContributorFn): void;

  // Returns a handle map keyed exactly like the input. Pass any handle to
  // `ctx.config(handle)` to get the value type narrowed by the key's `type`.
  // Optional `seeds` declare boot-time system-rows that are written via the
  // event-store executor — idempotent, skipped when the stream already exists.
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
  // on first registration. When you bump the payload shape, raise version
  // AND register r.eventMigration(shortName, N, N+1, transform) — the
  // framework refuses to boot if the chain from 1 → version has gaps.
  defineEvent<const TInner extends string, TPayload>(
    name: TInner,
    schema: ZodType<TPayload>,
    options?: { readonly version?: number },
  ): EventDef<TPayload, QualifiedEventName<TFeature, TInner>>;

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
  // Boot-validation rejects duplicate "method path"-Combinations.
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

  // Register the tree-provider for this feature — the Subscribe-Function
  // that emits the top-level Tree-Knoten when the Visual-Workspace
  // (navigation: "tree") mounts. At-most-one call per feature.
  //
  // Provider returns a Subscribe-Function (emit-fn → unsubscribe-fn).
  // Initial-emit synchron oder async, weitere Emits beliebig oft (e.g.
  // on entity-update SSE). Provider sind session-bound; tenantId fließt
  // über die Backend-Session bei fetch/dispatch, nicht über ein ctx-Arg.
  //
  // A feature without r.tree() is invisible in `navigation: "tree"`-
  // workspaces — that's the Zero-Whitelist-Filter from visual-tree.md A2:
  // provider-Vorhandensein ist der Filter, kein Workspace-Mapping.
  tree(provider: TreeChildrenSubscribe): void;
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

  // Tree-Providers declared via r.tree() across all features. Keyed by
  // declaring feature name (NOT qualified — Provider sind feature-bound,
  // ein Feature liefert genau eine Provider-Function). The Visual-Tree
  // component (renderer-web) iteriert getTreeProviders() beim Mount des
  // navigation: "tree"-Workspaces, ruft jeden Provider mit ctx auf,
  // sammelt die emitted TreeNode[] und merged sie zur Top-Level-Liste.
  // See visual-tree.md A2 (Zero-Whitelist) + A4 (Subscribe-Form).
  getTreeProviders(): ReadonlyMap<string, TreeChildrenSubscribe>;

  // Tree-Actions-Map des Features. Returns the erased Record (compile-
  // time-typed handle wandert über setup-export, nicht hier). Visual-
  // Tree-Component nutzt das für Runtime-Action-Lookup beim Klick auf
  // einen TreeNode.target — der Resolver findet das Feature via
  // TargetRef.featureId und holt sich die zugehörige Action-Definition.
  getTreeActions(featureName: string): Readonly<Record<string, TreeActionDef>> | undefined;
};
