import type * as z from "zod";
import type { ZodType } from "zod";
import type {
  ConfigKeyDefinition,
  ConfigKeyHandle,
  ConfigKeyType,
  ConfigSeedDef,
  ExtensionSelectorPanel,
  JobDefinition,
  JobHandlerFn,
  NotificationDataFn,
  NotificationLocalizedTemplate,
  NotificationRecipientFn,
  NotificationRecordMapping,
  NotificationTemplateBody,
  NotificationTemplateFn,
  NotificationTemplateMeta,
  RegistrarExtensionDef,
  TemplateVariables,
  TranslationsDef,
} from "./config.ts";
import type {
  QueryHandlerDefinition,
  StreamHandlerDefinition,
  WriteHandlerDefinition,
} from "./define-handler.ts";
import type { RegisterEntityCrudOptions } from "./entity-handlers.ts";
import type { EntityTableMeta } from "./entity-table-meta-types.ts";
import type { KumikoEventTypeMap } from "./event-type-map.ts";
import type { ExtensionOptionsArgs, ExtensionOptionsFor } from "./extension-options-map.ts";
import type {
  BootCheckFn,
  MetricOptions,
  SecretKeyHandle,
  SecretNamespaceHandle,
  SecretNamespaceOptions,
  SecretOptions,
  StoreTableOptions,
  UiHints,
  WebhookEventHandle,
} from "./feature.ts";
import type { EntityDefinition } from "./fields.ts";
import type {
  AccessRule,
  AuthClaimsFn,
  BeforeTransactionWhenNested,
  ClaimKeyHandle,
  ClaimKeyType,
  DeclarativeEventMigration,
  EntityRef,
  EscapeHatchDeclaration,
  EventDef,
  EventPiiStance,
  EventUpcastFn,
  HandlerRef,
  NameOrRef,
  QualifiedEventName,
  RateLimitDeclaration,
  StreamHandlerFn,
} from "./handlers.ts";
import type {
  HookPhase,
  PostDeleteHookFn,
  PostQueryHookFn,
  PostSaveHookFn,
  PreDeleteHookFn,
  PreSaveHookFn,
  SearchPayloadContributorFn,
  ValidationHookFn,
} from "./hooks.ts";
import type { HttpRouteDefinition } from "./http-route.ts";
import type { ContentCollectionDefinition, NavDefinition } from "./nav.ts";
import type { ProbeOptions } from "./probe.ts";
import type {
  EntityProjectionExtension,
  MultiStreamProjectionDefinition,
  ProjectionDefinition,
} from "./projection.ts";
import type { RelationDefinition } from "./relations.ts";
import type { ScreenDefinition } from "./screen.ts";
import type { TreeActionDef, TreeActionsHandle } from "./tree-node.ts";
import type { WebSocketRouteDefinition } from "./websocket-route.ts";
import type { WorkspaceDefinition } from "./workspace.ts";

// --- Feature Registrar (the "r" object in defineFeature) ---

type RefOrRefs = NameOrRef | readonly NameOrRef[];
// Entity-wide hook target — "all query/write handlers of this entity". Only valid
// for postSave/preDelete/postDelete/postQuery; the other hook types do not accept it.
type HookTarget = RefOrRefs | { readonly allOf: NameOrRef };

// `backingTable` points the entity at an existing drizzle table instead of a generated one.
export type EntityObjectDefinition = {
  readonly name: string;
  readonly backingTable?: unknown;
} & EntityDefinition;

type HookEscapeHatch = { readonly escapeHatch?: EscapeHatchDeclaration };
type HookPhaseOption = { readonly phase?: HookPhase };

// escapeHatch grants the hook (not the handler) identity switches beyond its caller — see
// system-identity-switch.ts. A hook type without a member field rejects it at compile time.
export type HookDefinition =
  | {
      readonly type: "validation";
      readonly target: RefOrRefs;
      readonly handler: ValidationHookFn;
      readonly escapeHatch?: never;
      readonly phase?: never;
    }
  | ({
      readonly type: "preSave";
      readonly target: RefOrRefs;
      readonly handler: PreSaveHookFn;
      readonly phase?: never;
    } & HookEscapeHatch)
  | ({
      readonly type: "postSave";
      readonly target: HookTarget;
      readonly handler: PostSaveHookFn;
    } & HookEscapeHatch &
      HookPhaseOption)
  | ({
      readonly type: "preDelete";
      readonly target: HookTarget;
      readonly handler: PreDeleteHookFn;
      readonly phase?: never;
    } & HookEscapeHatch)
  | ({
      readonly type: "postDelete";
      readonly target: HookTarget;
      readonly handler: PostDeleteHookFn;
    } & HookEscapeHatch &
      HookPhaseOption)
  | ({
      readonly type: "postQuery";
      readonly target: HookTarget;
      readonly handler: PostQueryHookFn;
      readonly phase?: never;
    } & HookEscapeHatch);

/**
 * `r.requires({ features })` declares the features this one depends on; the
 * `.projection` extension declares read-side projection tables that this
 * feature's pipeline steps are allowed to write via
 * `r.step.unsafeProjectionUpsert` (hard-required for any unsafeProjection-*
 * step usage, see Q10).
 *
 * @example r.requires({ features: ["auth", "tenant"] });
 */
export type RequiresApi = ((options: { readonly features: readonly string[] }) => void) & {
  readonly projection: (tableName: string) => void;
  // Tier-2 step opt-in. Tier-1 implicit, Tier-2 must be declared.
  readonly step: (stepKind: string) => void;
};

/**
 * `TFeature` is the literal feature-name from `defineFeature("foo", ...)` —
 * default-`string` keeps every existing usage zero-config. Strict-typed
 * features (apps that opt into the literal-name flavour) get propagated
 * through to `defineEvent` so the returned `EventDef.name` is a literal
 * `${CamelToKebab<TFeature>}:event:${CamelToKebab<TInner>}`. That literal
 * threads through `ctx.events.append({ type: eventDef.name, ... })`,
 * keeping strict-mode alive even when handlers route via `eventDef.name`
 * instead of hand-typed string literals.
 */
export type FeatureRegistrar<TFeature extends string = string> = {
  systemScope(): void;
  // One-to-three-sentence docs-lead for the feature ("what it does + when
  // you need it"). At most once per feature; must be non-empty.
  describe(text: string): void;
  requires: RequiresApi;
  optionalRequires(...featureNames: string[]): void;
  optionalRequires(options: { readonly features: readonly string[] }): void;
  // Declare the feature as operator-togglable. `default` is the effective
  // state when no global-toggle row exists. Must be called at most once per
  // feature; calling on an always-on feature (e.g. auth/tenant/user) is a
  // bug — and one nothing catches at boot, so don't.
  toggleable(options: { default: boolean }): void;
  // Opt the feature's list screens into the app-wide `bundledLists` table block.
  // For feature packages only; idempotent.
  adoptsBundledLists(): void;
  // Picker/scaffolder metadata — see UiHints. At most once per feature.
  uiHints(hints: UiHints): void;

  /**
   * @example r.entity({ name: "note", fields: { title: createTextField({ required: true }) } });
   */
  entity(definition: EntityObjectDefinition): EntityRef;

  // Registers the entity plus its standard CRUD handlers, scoped to this registrar.
  crud(entityName: string, entity: EntityDefinition, options?: RegisterEntityCrudOptions): void;

  /**
   * @example r.writeHandler({ name: "note:archive", schema, handler, access: { roles: ["User"] } });
   */
  writeHandler<
    TName extends string,
    TSchema extends ZodType,
    TPrepared = undefined,
    TWhenNested extends BeforeTransactionWhenNested | undefined = undefined,
  >(
    def: WriteHandlerDefinition<
      TName,
      TSchema,
      unknown,
      KumikoEventTypeMap,
      TPrepared,
      TWhenNested
    >,
  ): HandlerRef;

  /**
   * @example r.queryHandler({ name: "note:list", schema, handler, access: { roles: ["User"] } });
   */
  queryHandler<TName extends string, TSchema extends ZodType>(
    def: QueryHandlerDefinition<TName, TSchema>,
  ): HandlerRef;

  streamHandler<TName extends string, TSchema extends ZodType>(
    def: StreamHandlerDefinition<TName, TSchema>,
  ): HandlerRef;
  streamHandler<TSchema extends ZodType>(
    name: string,
    schema: TSchema,
    handler: StreamHandlerFn<z.infer<TSchema>>,
    options: {
      access: AccessRule;
      rateLimit?: RateLimitDeclaration;
      escapeHatch?: EscapeHatchDeclaration;
    },
  ): HandlerRef;

  relation(entity: NameOrRef, relationName: string, definition: RelationDefinition): void;
  // TDef inferred from the literal — keeps the excess-property check
  // resolved against the matching RelationDefinition union member instead
  // of distributing across all three (which spuriously rejects valid
  // combinations when checked directly against the raw union).
  relation<TDef extends RelationDefinition>(
    definition: { readonly entity: NameOrRef; readonly name: string } & TDef,
  ): void;

  /**
   * @example r.hook({ type: "postSave", target: { allOf: noteRef }, handler: notifyOwner });
   */
  hook(definition: HookDefinition): void;

  // Search-Payload-Extension: contributor function adds flat fields to
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
  job(definition: JobDefinition): void;

  notification(
    name: string,
    definition: {
      readonly trigger?: { readonly on: NameOrRef };
      readonly recipient?: NotificationRecipientFn;
      readonly data?: NotificationDataFn;
      readonly templates?: Readonly<Record<string, NotificationTemplateFn>>;
      readonly variables?: TemplateVariables;
      readonly record?: NotificationRecordMapping;
      readonly template?: Readonly<Record<string, NotificationTemplateBody>>;
      readonly meta?: Readonly<Record<string, NotificationTemplateMeta>>;
      readonly localizedTemplate?: () => NotificationLocalizedTemplate;
      readonly renamedFrom?: readonly string[];
      readonly systemOnly?: boolean;
      readonly unsubscribe?: boolean;
      readonly tenantTransport?: boolean;
    },
  ): void;
  notification(definition: {
    readonly name: string;
    readonly trigger?: { readonly on: NameOrRef };
    readonly recipient?: NotificationRecipientFn;
    readonly data?: NotificationDataFn;
    readonly templates?: Readonly<Record<string, NotificationTemplateFn>>;
    readonly variables?: TemplateVariables;
    readonly record?: NotificationRecordMapping;
    readonly template?: Readonly<Record<string, NotificationTemplateBody>>;
    readonly meta?: Readonly<Record<string, NotificationTemplateMeta>>;
    readonly localizedTemplate?: () => NotificationLocalizedTemplate;
    readonly renamedFrom?: readonly string[];
    readonly systemOnly?: boolean;
    readonly unsubscribe?: boolean;
    readonly tenantTransport?: boolean;
  }): void;

  translations(def: TranslationsDef): void;

  // Register an event payload shape. Returns the qualified def so callers
  // can pass `.name` to ctx.events.append without hand-building the
  // "<feature>:event:<short>" string.
  //
  // `options.version` declares the CURRENT schema generation. Defaults to 1
  // on first registration. When you bump the payload shape, add a step to
  // `options.migrations` covering N -> N+1 — the framework refuses to boot
  // if the chain from 1 to `version` has gaps. Migrations were formerly a
  // separate r.eventMigration() call; folded in here because an event and
  // its schema evolution are one lifecycle, not two registrar concepts
  // — transforms are pure functions (old payload in, new
  // payload out) and run once per read, not once per event persisted, so
  // keep them cheap.
  //
  // `options.piiFields` is a mandatory, explicit PII stance —
  // registration fails without one. Pass a map of payload fields to their
  // owning subject via `{ personal: { of: "<ownerField>" } }` (the older
  // `{ subjectField: "<ownerField>" }` form still works) for fields carrying
  // personal data (encrypted under that user's DEK, crypto-shredding),
  // or `"none"` to declare the payload holds no personal data. append()
  // enforces the resulting catalog on every write path.
  //
  // When the schema lets the owner field be null/undefined, the stance must
  // also say what happens on those writes — `whenAbsent: "tenant"` encrypts
  // under the envelope tenant key, `whenAbsent: "plaintext"` acknowledges an
  // unshreddable value. Registration fails without one, and an owner that is
  // empty at append time with no declared fallback aborts the write.
  defineEvent<const TInner extends string, TPayload>(
    name: TInner,
    schema: ZodType<TPayload>,
    options: {
      readonly version?: number;
      readonly piiFields: EventPiiStance;
      readonly migrations?: readonly {
        readonly fromVersion: number;
        readonly toVersion: number;
        readonly transform: EventUpcastFn | DeclarativeEventMigration;
      }[];
    },
  ): EventDef<TPayload, QualifiedEventName<TFeature, TInner>>;

  // Public payload contract of a webhook event. Separate from defineEvent so
  // internal event refactors never change what integrations receive; a token
  // scope can only release events that have such a contract (or an entity event).
  defineWebhookEvent(definition: {
    readonly name: string;
    readonly description: string;
    readonly payload: z.ZodObject;
    readonly version: number;
  }): WebhookEventHandle;

  readsConfig(...qualifiedKeys: string[]): void;
  readsConfig(options: { readonly keys: readonly string[] }): void;

  referenceData(
    entity: NameOrRef,
    data: readonly Record<string, unknown>[],
    options?: { upsertKey?: string },
  ): void;
  referenceData(definition: {
    readonly entity: NameOrRef;
    readonly data: readonly Record<string, unknown>[];
    readonly upsertKey?: string;
  }): void;

  extendsRegistrar(name: string, def: RegistrarExtensionDef): void;

  useExtension<N extends string>(
    extensionName: N,
    entity: NameOrRef,
    ...options: ExtensionOptionsArgs<N>
  ): void;
  useExtension<N extends string>(
    definition: { readonly name: N; readonly entity: NameOrRef } & ExtensionOptionsFor<N>,
  ): void;

  /**
   * Declares which config key selects the active provider under an
   * extension point — called by the point-owning foundation (e.g.
   * `r.extensionSelector("mailTransport", configKeys.provider)`).
   * Readiness gating counts a provider-feature's `required` keys and
   * secrets only while that provider is the selected one. Registry-build
   * fails on duplicate declarations per extension and on selector keys
   * that no mounted feature declares. A masked tenant selector key makes the
   * Settings-Hub render one tenant dashboard for the owner: the selector as a
   * select of the mounted plugin ids, the selected plugin's config and secrets
   * as panels, and plugin features lose their own tenant nav. `config:write:set`
   * rejects unknown plugin ids (`""` clears). `options.panels` adds the owner's own
   * `custom`/`screen` panels to that dashboard, after the selection and before the
   * plugin panels (a short `screen` id means a screen of the declaring feature).
   */
  extensionSelector(
    extensionName: string,
    key: { readonly name: string } | string,
    options?: { readonly panels?: readonly ExtensionSelectorPanel[] },
  ): void;

  /**
   * Marker declaration: this feature provides a cross-feature API under the
   * given name. The implementation is registered separately as a query or
   * write handler under the QN pattern; `r.exposesApi` is only a boot-check
   * surface.
   *
   * The boot validator checks that every `r.usesApi(name)` finds a matching
   * exposer, that the exposer feature is listed in requires/optionalRequires,
   * and that no API name is exposed more than once.
   *
   * ```ts
   * defineFeature("compliance-profiles", (r) => {
   *   r.exposesApi("compliance.forTenant");
   *   r.queryHandler({
   *     name: "compliance:query:for-tenant",
   *     // ... actual implementation
   *   });
   * });
   * ```
   */
  exposesApi(apiName: string): void;

  /**
   * Declares that this feature calls a cross-feature API. The boot validator
   * checks that another feature provides `r.exposesApi(apiName)` and that
   * this feature lists it in `r.requires/optionalRequires`.
   *
   * ```ts
   * defineFeature("user-data-rights", (r) => {
   *   r.requires({ features: ["compliance-profiles"] });
   *   r.usesApi("compliance.forTenant");
   * });
   * ```
   */
  usesApi(apiName: string): void;

  /**
   * Declares a boot-time mount-invariant for this feature. `fn` runs once
   * at boot with a ctx exposing every mounted feature — throw to fail the
   * boot with a clear message. Multiple calls per feature are allowed.
   *
   * Use for cross-feature invariants that `r.requires` can't express
   * because they're conditional (only fail when the feature has a
   * specific shape), e.g. "if this feature has PII entities, some
   * user-data-hook feature must be mounted" (the prompt-store trap —
   * a UserData feature was written but never mounted, and nothing caught
   * it at boot):
   *
   * ```ts
   * defineFeature("prompt-store", (r) => {
   *   const promptFields = { text: createTextField({ personal: "self", find: "none" }) };
   *   r.entity({ name: "prompt", fields: promptFields });
   *   r.bootCheck(({ features }) => {
   *     // Conditional on this feature's own shape (has a pii field) —
   *     // r.requires({ features: ["user-data-hook"] }) can't express that, it would fail
   *     // even for a prompt-store variant with no PII fields at all.
   *     const hasPiiField = Object.values(promptFields).some((f) => f.pii);
   *     const hasUserDataHook = features.some((f) => f.name === "user-data-hook");
   *     if (hasPiiField && !hasUserDataHook) {
   *       throw new Error("prompt-store has PII fields but no user-data-hook feature is mounted");
   *     }
   *   });
   * });
   * ```
   */
  bootCheck(fn: BootCheckFn): void;

  // Declare a metric. Short name (without kumiko_<feature>_ prefix) — Framework
  // qualifies it on boot. Validation (snake_case + typ-suffix) runs at boot.
  // Usage at runtime: ctx.obs.metrics.inc("created_total", { status: "new" }).
  metric(shortName: string, options: MetricOptions): void;
  metric(definition: { readonly name: string } & MetricOptions): void;

  // Declare a secret key. Qualified name follows "<feature>:secret:<kebab>"
  // via the QN helper. Returns a typed handle so feature code can pass it
  // to ctx.services.secrets.get without retyping the qualified string — same
  // ergonomics as r.config's handle.
  secret(shortName: string, options: SecretOptions): SecretKeyHandle;
  secret(definition: { readonly name: string } & SecretOptions): SecretKeyHandle;

  // Declare a live probe the readiness system check runs against the real environment; failure = throw.
  probe(options: ProbeOptions): void;

  // Declare a namespace of runtime-named secret keys. The prefix is
  // "<feature>:<kebab name>." — secrets:write:set/delete accept any key under
  // it whose suffix passes options.nameSchema.
  secretNamespace(shortName: string, options: SecretNamespaceOptions): SecretNamespaceHandle;
  secretNamespace(
    definition: { readonly name: string } & SecretNamespaceOptions,
  ): SecretNamespaceHandle;

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
  claimKey<T extends ClaimKeyType>(definition: {
    readonly name: string;
    readonly type: T;
  }): ClaimKeyHandle<T>;

  // Register a screen. The id is the feature-local short name (kebab-case);
  // the registry qualifies to "<feature>:screen:<id>". Boot-validation checks
  // that entity-bound screens reference a registered entity and that the
  // columns / form-field refs name real fields — cross-feature component-QN
  // validation (r.uiComponent) comes later. Optional `nav` field is
  // sugar for a single nav entry pointing at this screen — equivalent to
  // a standalone r.nav({ id: <same id>, screen: "<feature>:screen:<id>", ... }).
  screen(definition: ScreenDefinition): void;

  // Register a nav entry. The id is the feature-local short name (kebab-case);
  // the registry qualifies to "<feature>:nav:<id>". Boot-validation checks
  // that `screen` and `parent` refs exist (cross-feature QNs allowed) and
  // that parent chains don't contain cycles.
  nav(definition: NavDefinition): void;

  // Register a content collection — a set of template-resources of one kind,
  // navigable where it fachlich belongs (mail templates under Mail, not under
  // a central "Content" section). Sugar over r.nav(): registers the nav entry
  // with `provider: true` under the same id and records the kind so the client
  // can wire the tree provider without repeating navId + kind.
  //
  // Returns the qualified nav name ("<feature>:nav:<id>") — apps that pass the
  // collection to a client feature explicitly take it from here instead of
  // re-typing the QN.
  contentCollection(definition: ContentCollectionDefinition): string;

  // Register a workspace — a persona-/role-scoped UI surface. Pure UI
  // composition; the registry qualifies the short id to
  // "<feature>:workspace:<id>". Boot-validation checks that any nav refs
  // exist, that workspace ids referenced from r.nav() are real, and that
  // at most one workspace per app declares `default: true`.
  workspace(definition: WorkspaceDefinition): void;

  // Register an HTTP-route owned by this feature. The route is mounted
  // outside the dispatcher pipeline (= outside /api/write|query|batch),
  // directly on the app — use case: RSS/Atom feeds, OG images, OpenAPI specs.
  // Duplicate "method path"-Combinations are rejected per feature at setup
  // time; there is no cross-feature check.
  // Symmetric to queryHandler/writeHandler — routes live with the feature,
  // not in the bootstrap. Escape-hatch for non-feature-bound routes stays
  // runProdApp.extraRoutes (declarative list with `entry` tier).
  httpRoute(definition: HttpRouteDefinition): void;

  // Register a WebSocket endpoint under /api/ws/*. Rides the /api/* auth
  // chain; the framework adds a cookie-session origin check, a per-message
  // size cap and a heartbeat with session re-validation. Duplicate paths are
  // rejected per feature here and across features in buildServer.
  webSocketRoute(definition: WebSocketRouteDefinition): void;

  // Declare an "unmanaged" framework-native table that bypasses the
  // event-sourcing system. Reserved for legacy-import, read-only caches,
  // write-only webhook payload buffers, or read-side projections of
  // event-streams (delivery-attempts, job-run-logs) where r.entity()'s
  // aggregate-lifecycle assumptions don't fit. The dev-server iterates
  // these alongside r.entity() projections at boot so the table exists
  // before the first query.
  //
  // EntityTableMeta carries the same column-shape that r.entity() builds,
  // minus the audit-trail + base-columns scaffolding. The `meta` argument
  // is the result of `defineUnmanagedTable(...)` / `deriveEntityTableMeta(...)`
  // from `@cosmicdrift/kumiko-framework/db`.
  //
  // The required `reason` string is the marker that justifies the bypass —
  // a non-empty string is the contract. If you can't write a reason,
  // declare data via `r.entity()` instead.
  storeTable(meta: EntityTableMeta, options: StoreTableOptions): void;

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
  // every action becomes accept-anything-string. See visual-tree.md.
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
