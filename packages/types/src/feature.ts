import type * as z from "zod";
import type { ZodType } from "zod";
import type {
  ConfigKeyDefinition,
  ConfigSeedDef,
  ExtensionSelectorDef,
  ExtensionSelectorPanel,
  JobDefinition,
  NotificationDefinition,
  ReferenceDataDef,
  RegistrarExtensionDef,
  RegistrarExtensionRegistration,
  TranslationKeys,
} from "./config.ts";
import type { EntityTableMeta } from "./entity-table-meta-types.ts";
import type { EntityDefinition } from "./fields.ts";
import type {
  AuthClaimsFn,
  AuthClaimsHookDef,
  ClaimKeyDefinition,
  EventDef,
  EventMigrationDef,
  EventUpcastFn,
  QueryHandlerDef,
  StreamHandlerDef,
  WriteHandlerDef,
} from "./handlers.ts";
import type {
  EntityHookMap,
  HookMap,
  HookPhase,
  OwnedFn,
  PostDeleteHookFn,
  PostQueryHookFn,
  PostSaveHookFn,
  PreDeleteHookFn,
  PreSaveHookFn,
  SearchPayloadContributorFn,
} from "./hooks.ts";
import type { HttpRouteDefinition } from "./http-route.ts";
import type { ContentCollectionDefinition, NavDefinition } from "./nav.ts";
import type { ProbeDefinition } from "./probe.ts";
import type {
  EntityProjectionExtension,
  MultiStreamProjectionDefinition,
  ProjectionDefinition,
} from "./projection.ts";
import type { EntityRelations, RelationDefinition } from "./relations.ts";
import type { ScreenDefinition } from "./screen.ts";
import type { TreeActionDef } from "./tree-node.ts";
import type { WebSocketRouteDefinition } from "./websocket-route.ts";
import type { WorkspaceDefinition } from "./workspace.ts";

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
// `<kebab-feature>:secret:<kebab-shortName>`, set by r.secret(). Ops see the
// qualified name in list / audit; feature code reads it via
// ctx.services.secrets.get(tenantId, SecretKeys.stripeKey) with the typed handle.
// Reference: docs/reference/secret-keys.md.
export type SecretKeyDefinition = {
  // Short name inside the feature (e.g. "stripe.apiKey").
  readonly shortName: string;
  // `<kebab-feature>:secret:<kebab-shortName>`.
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
  // Roles allowed to set/delete this key. Narrows the secrets handler access
  // (both must pass); absent = the handler access alone decides.
  readonly writeRoles?: readonly string[];
  // Checked by the secrets write gate on set; a failure answers generically,
  // without the value or the schema's issues. Stored secrets are not re-checked.
  readonly valueSchema?: ZodType<string>;
};

export type SecretOptions = Omit<SecretKeyDefinition, "shortName" | "qualifiedName">;

// A family of secret keys whose suffix is chosen at runtime (e.g. one webhook
// auth token per tenant-picked name). The stored key is
// `<qualifiedPrefix><name>`; the prefix ends in "." and is derived from
// `<feature>:<shortName>.` at declaration time. Kept out of secretKeys so the
// generated secrets screen only lists fixed keys.
export type SecretNamespaceDefinition = {
  readonly shortName: string;
  readonly qualifiedPrefix: string;
  readonly label: { readonly [locale: string]: string };
  readonly hint?: { readonly [locale: string]: string };
  readonly scope: "tenant";
  // Same meaning as SecretKeyDefinition.writeRoles, for every key in the namespace.
  readonly writeRoles?: readonly string[];
  // Validates the suffix after the prefix. Absent = any non-empty suffix.
  readonly nameSchema?: ZodType<string>;
  // Same meaning as SecretKeyDefinition.valueSchema, for every key in the namespace.
  readonly valueSchema?: ZodType<string>;
};

export type SecretNamespaceOptions = Omit<
  SecretNamespaceDefinition,
  "shortName" | "qualifiedPrefix"
>;

export type SecretNamespaceHandle = {
  readonly prefix: string;
  keyFor(name: string): string;
};

// Typed reference returned by r.secret(). Lets feature code pass a
// strongly-named handle to ctx.services.secrets.get instead of retyping the
// qualified string. Parallels ConfigKeyHandle from the config system.
export type SecretKeyHandle = {
  readonly name: string;
};

// --- Store tables (declared by features via r.storeTable()) ---
// Post-drizzle-cut: unified with the former r.unmanagedTable() — both
// carried the same reason/audit contract, differing only in whether the
// table value was a legacy Drizzle PgTable (storeTable) or the framework-
// native EntityTableMeta (unmanagedTable, consumed by migrate-runner).
// EntityTableMeta was the forward-compatible shape, so storeTable adopted it.

/** Options accepted by `r.storeTable()`. The `reason` is required so the
 *  bypass leaves an audit trail at the registration site — reviewers can
 *  judge legitimacy without spelunking into history, and a future cleanup
 *  pass can find candidates for migration to `r.entity()`. */
export type StoreTableOptions = {
  /** Why this table needs to bypass the event-sourcing system. Examples:
   *  "imported from pre-ES system, read-only", "external Stripe webhook
   *  payload cache, write-only by webhook handler", "denormalised
   *  projection of a non-Kumiko data source". */
  readonly reason: string;
  /** Direct-write stores skip the executor, so the executor's PII
   *  encryption never runs for them — a feature whose meta carries
   *  piiSubjectFields must encrypt those fields itself before every
   *  insert/update and declare that here, or boot fails. */
  readonly piiEncryptedOnWrite?: true;
};

/** Per-feature store-table registration. `meta` is the `EntityTableMeta`
 *  (framework-native shape used by `migrate-runner`). Carries the
 *  bypass-justification reason but knows nothing about the owning
 *  feature — that's added when the registry aggregates entries
 *  cross-feature into `StoreTableDef`. */
export type StoreTableEntry = {
  readonly name: string;
  readonly meta: EntityTableMeta;
  readonly reason: string;
  readonly piiEncryptedOnWrite?: true;
};

/** Registry-aggregated store-table — the per-feature `StoreTableEntry` plus
 *  the owning feature name. This is what `Registry.getAllStoreTables()`
 *  exposes to readers (dev-server, ops UIs). */
export type StoreTableDef = StoreTableEntry & {
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

// Ctx passed to r.bootCheck(fn) — the full mounted-feature set, so a check
// can inspect any other feature's shape (entities, PII fields, etc.).
export type BootCheckContext = {
  readonly features: readonly FeatureDefinition[];
};
export type BootCheckFn = (ctx: BootCheckContext) => void;

/** runProdApp options a stack can depend on; runProdApp checks the set at boot. */
export type BootOptionName =
  | "mail"
  | "kmsMode"
  | "fileStorage"
  | "billing"
  | "featureToggles"
  | "rateLimit";

export type StackBootRequirement = {
  readonly stack: string;
  readonly options: readonly BootOptionName[];
  /** `"warn"`: a missing option logs a boot warning instead of aborting. Default `"error"`. */
  readonly severity?: "error" | "warn";
};

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
  // Tier-2 step kinds opted-in via r.requires.step("webhook.send").
  readonly requiredSteps: ReadonlySet<string>;
  // Declared via r.toggleable({ default }). Presence makes the feature
  // operator-switchable via the feature-toggles bundled feature; absence
  // means the feature is always-on (e.g. auth, tenant, user — core infra
  // that would brick the system if switchable).
  readonly toggleableDefault?: boolean;
  // Set via r.adoptsBundledLists(): the feature takes the app-wide `bundledLists`
  // block from composeFeatures. App features never set this.
  readonly adoptsBundledLists?: true;
  // Declarative UI metadata for picker/scaffolder tooling. Set via r.uiHints().
  // Pure manifest-side info — the framework runtime doesn't read it.
  readonly uiHints?: UiHints;
  // entities/hooks/entityHooks are optional: defineFeature always
  // materializes them, but hand-built definitions at system boundaries
  // (test fixtures, partial boots — see registry.test.ts "slot robustness")
  // omit them and the registry guards against that. Type follows runtime.
  readonly entities?: Readonly<Record<string, EntityDefinition>>;
  // Optional backing Drizzle table per entity, declared via `backingTable` in
  // `r.entity({ name, ...def, backingTable })`. Source of truth for the physical DDL
  // when the table carries columns/indexes the field-DSL can't express
  // (e.g. secrets' envelope jsonb without default). `collectTableMetas` and
  // the registry's implicit-projection use this object instead of the
  // field-derived table, so generate + test-push + executor share ONE table.
  readonly entityTables?: Readonly<Record<string, unknown>>;
  readonly relations: Readonly<Record<string, EntityRelations>>;
  readonly writeHandlers: Readonly<Record<string, WriteHandlerDef>>;
  readonly queryHandlers: Readonly<Record<string, QueryHandlerDef>>;
  readonly streamHandlers: Readonly<Record<string, StreamHandlerDef>>;
  readonly translations: TranslationKeys;
  readonly hooks?: HookMap;
  readonly entityHooks?: EntityHookMap;
  // Search-payload-extension — per-entity contributors that add flat fields
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
   * Pure marker declaration — the implementation is registered separately as
   * a query or write handler under the QN pattern (for example,
   * `compliance-profiles:query:effective-profile`). The boot validator checks
   * that every `r.usesApi(name)` finds a matching exposer, so typos or dropped
   * refactors fail at boot instead of causing a runtime crash.
   */
  readonly exposedApis: ReadonlySet<string>;
  /**
   * Cross-feature API names this feature calls. The boot check requires every
   * entry to appear in some feature's `exposedApis` and the provider feature
   * to be listed in requires/optionalRequires.
   */
  readonly usedApis: ReadonlySet<string>;
  /**
   * Boot-time mount-invariant checks declared via `r.bootCheck(fn)`. Run
   * once per feature after all other boot-validators, each with a ctx
   * exposing the full mounted-feature set — throw to fail the boot with a
   * feature-authored message (framework wraps it with `[Feature <name>]`).
   */
  readonly bootChecks: readonly BootCheckFn[];
  // Set by the compose*Stack helpers on the feature that needs the option.
  readonly bootRequires?: StackBootRequirement;
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
  // Secret namespaces declared via r.secretNamespace(), keyed by short name.
  readonly secretNamespaces: Readonly<Record<string, SecretNamespaceDefinition>>;
  // Live probes declared via r.probe(), keyed by short name. Optional: most features declare none.
  readonly probes?: Readonly<Record<string, ProbeDefinition>>;
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
  // not this slot. See visual-tree.md.
  readonly treeActions?: Readonly<Record<string, TreeActionDef>>;
  // Content collections declared via r.contentCollection(). Keyed by the
  // feature-local short id. Each one also produced a nav entry under the
  // same id — this slot carries the `kind` the client needs to build the
  // matching tree provider, which a NavDefinition has no place for.
  readonly contentCollections?: Readonly<Record<string, ContentCollectionDefinition>>;
  // HTTP routes declared via r.httpRoute(). The index is "METHOD path"
  // (for example, "GET /feed.xml") and is unique per feature. The app-server
  // boot stage iterates getAllHttpRoutes() and mounts each route on the Hono
  // app outside /api/*. The pattern mirrors queryHandlers/writeHandlers:
  // routes belong to the feature, not the bootstrap.
  readonly httpRoutes: Readonly<Record<string, HttpRouteDefinition>>;
  // WebSocket routes declared via r.webSocketRoute(), keyed by path.
  readonly webSocketRoutes: Readonly<Record<string, WebSocketRouteDefinition>>;
  // Store tables declared via r.storeTable() — bypass the event-sourcing
  // system. Keyed by feature-local short name (derived from
  // meta.tableName). The registry attaches featureName on aggregation,
  // lifting StoreTableEntry → StoreTableDef. `kumiko schema generate`
  // aggregates these alongside r.entity()-derived metas to build the
  // full schema.
  readonly storeTables: Readonly<Record<string, StoreTableEntry>>;
  // Optional Zod-schema for env-vars this feature reads at runtime.
  // Declared via `r.envSchema(z.object({...}))`. `composeEnvSchema` reads
  // this to build one app-wide schema for boot-validation + dry-run
  // rendering. Absence means the feature reads no env-vars (or hasn't
  // been migrated yet — migration is add-only per phase).
  readonly envSchema?: z.ZodObject<z.ZodRawShape>;
  // Factory guarantee: two instances with shallow-equal dedupeOptions are interchangeable.
  // Compared with Object.is per key: values must be primitives or stable function
  // references; defineFeature rejects nested objects.
  readonly dedupeOptions?: Readonly<Record<string, unknown>>;
};

// --- Registry (created from features) ---

export type Registry = {
  readonly features: ReadonlyMap<string, FeatureDefinition>;

  getFeature(name: string): FeatureDefinition | undefined;
  getEntity(name: string): EntityDefinition | undefined;
  getAllEntities(): ReadonlyMap<string, EntityDefinition>;
  getWriteHandler(name: string): WriteHandlerDef | undefined;
  getQueryHandler(name: string): QueryHandlerDef | undefined;
  getAllQueryHandlers(): ReadonlyMap<string, QueryHandlerDef>;
  getAllWriteHandlers(): ReadonlyMap<string, WriteHandlerDef>;
  getStreamHandler(name: string): StreamHandlerDef | undefined;
  getAllStreamHandlers(): ReadonlyMap<string, StreamHandlerDef>;
  getSearchableFields(entityName: string): readonly string[];
  getSortableFields(entityName: string): readonly string[];
  getRelations(entityName: string): EntityRelations;
  getSearchableReferences(entityName: string): ReadonlyArray<{
    fieldName: string;
    targetEntityName: string;
    labelField: string;
  }>;
  getSortableReferences(entityName: string): ReadonlyArray<{
    fieldName: string;
    targetEntityName: string;
    labelField: string;
  }>;
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
  // Contributors for an entity's search-doc-payload, fired during
  // buildSearchDocument indexing. See `SearchPayloadContributorFn`.
  // `effectiveFeatures` filters out contributors owned by feature-toggle-
  // disabled features (parallel to other getters' filtering semantic).
  getSearchPayloadExtensions(
    entityName: string,
    effectiveFeatures?: ReadonlySet<string>,
  ): readonly SearchPayloadContributorFn[];
  getHandlerEntity(qualifiedHandler: string): string | undefined;
  isHandlerSystemScoped(qualifiedHandler: string): boolean;
  // Job counterpart to isHandlerSystemScoped — a job's owning feature is
  // tracked separately (jobFeatureMap) since jobs aren't write/query/stream
  // handlers and don't populate handlerFeatureMap.
  isJobSystemScoped(qualifiedJobName: string): boolean;
  getHandlerFeature(qualifiedHandler: string): string | undefined;
  // Same raw feature name getHandlerFeature returns, so job- and handler-written
  // events carry one metadata.feature value per feature.
  getJobFeature(qualifiedJobName: string): string | undefined;
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
  // The declared namespace whose prefix the key starts with, if any.
  findSecretNamespace(key: string): SecretNamespaceDefinition | undefined;
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
  // Owner panels declared via r.extensionSelector(..., { panels }); [] when none.
  getExtensionSelectorPanels(extensionName: string): readonly ExtensionSelectorPanel[];
  getAllNotifications(): ReadonlyMap<string, NotificationDefinition>;
  getAllReferenceData(): readonly ReferenceDataDef[];
  // Look up projections by source-entity name. Empty list when no projection
  // feeds off the entity — event-store-executor uses this as the hot-path.
  getProjectionsForSource(entityName: string): readonly ProjectionDefinition[];
  getAllProjections(): ReadonlyMap<string, ProjectionDefinition>;

  // All r.storeTable() registrations across all features, keyed by
  // feature-local short name. The dev-server iterates this alongside
  // implicit projections at boot. Cross-feature uniqueness is enforced
  // at registry-build — duplicate names from different features fail
  // the boot, so callers can rely on a flat keyspace.
  getAllStoreTables(): ReadonlyMap<string, StoreTableDef>;

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

  // The feature's tree-actions map. Returns the erased Record; the
  // compile-time-typed handle travels through the setup export instead.
  // Content-tree navigation uses this for runtime action lookup when a
  // TreeNode.target is clicked — the resolver finds the feature through
  // TargetRef.featureId and retrieves its action definition.
  getTreeActions(featureName: string): Readonly<Record<string, TreeActionDef>> | undefined;
};
