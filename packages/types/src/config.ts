import type { ZodType } from "zod";
import type { ConcurrencyMode } from "./concurrency-mode";
import type { ConfigScope } from "./config-scope";
import type { DbConnection } from "./db-connection";
import type { FieldDefinition } from "./fields";
import type { AppContext } from "./handlers";
import type {
  PostDeleteHookFn,
  PostSaveHookFn,
  PreDeleteHookFn,
  PreQueryHookFn,
  PreSaveHookFn,
} from "./hooks";
import type { TenantId } from "./identifiers";
import type { TenantDb } from "./tenant-db-types";

// --- Config ---

export type ConfigKeyAccess = {
  readonly read: readonly string[];
  readonly write: readonly string[];
};

export type ConfigKeyType = "text" | "number" | "boolean" | "select";

export type ConfigValue<T extends ConfigKeyType> = T extends "number"
  ? number
  : T extends "boolean"
    ? boolean
    : T extends "text" | "select"
      ? string
      : never;

// Bounds for numeric config keys. Enforced as hard-reject (not silent-clamp)
// in set.write.ts: a tenant-admin setting a value outside [min, max] gets a
// 400 "out_of_bounds" — silent clamping would be a UX trap ("I entered 9999,
// it saved as 1000, why?"). Per-Request helpers MAY clamp — that's a
// different call site where the caller often can't control the exact value.
// Only meaningful for type="number"; boot-validator rejects on other types.
export type ConfigBounds = {
  readonly min?: number;
  readonly max?: number;
};

// Ctx a `computed` key-resolver gets. Mirrors what the resolver itself has:
// tenantId + userId for scope-aware lookups, db for ad-hoc queries (e.g.
// "read the current subscription plan for this tenant"). Intentionally
// narrow — giving it the full AppContext would leak deps like `redis`
// into declaration-level code that shouldn't need them.
export type ConfigComputedContext = {
  readonly tenantId: TenantId;
  readonly userId: string;
  readonly db: DbConnection | TenantDb;
};

// Computed-value resolver. Called when no scope-row AND no app-boot-override
// exist for this key — sits one step above keyDef.default.
//
// Use-case: plan-based limits ("Pro tenants get maxUploadSizeMB=100"). The
// feature declares *how* to compute the value, the handler stays neutral:
//   const max = await ctx.config(handle);  // resolver calls computed
//
// Row wins over computed: a tenant-admin that sets a specific value
// overrides the plan-default. If you want "plan is a hard policy", reject
// set on the handler-side — don't try to invert the cascade.
export type ConfigComputedFn<T extends ConfigKeyType = ConfigKeyType> = (
  ctx: ConfigComputedContext,
) => Promise<ConfigValue<T>>;

// Storage-Backing eines provisionierten Config-Keys. "config" (Default) =
// config_values-Projektion mit voller Cascade (user→tenant→system→app→default).
// "secrets" = read_tenant_secrets (flach pro (tenant,key), AES-GCM-Envelope mit
// Rotation/Audit, KEINE Cascade) — nur sinnvoll für scope:system ohne
// Tenant-Override. Die backing×scope-Matrix erzwingt der boot-validator.
export type ConfigBacking = "config" | "secrets";

// Minimal read surface the config resolver needs to dispatch a
// backing="secrets" key to the secrets store, without coupling the engine
// types to the full SecretsContext. The app's `ctx.secrets` (a SecretsContext)
// is structurally assignable. Threaded per-call (not at resolver construction)
// because the resolver is framework-auto-created while `ctx.secrets` is
// app-provided — only the request context sees both.
export type ConfigSecretsReader = {
  get(tenantId: TenantId, key: string): Promise<{ readonly reveal: () => string } | undefined>;
};

export type ConfigKeyDefinition<T extends ConfigKeyType = ConfigKeyType> = {
  readonly type: T;
  readonly default?: ConfigValue<T>;
  readonly scope: ConfigScope;
  readonly access: ConfigKeyAccess;
  readonly encrypted?: boolean;
  /** User/admin may legitimately see the value — unlike `encrypted`
   *  (shared master-key cipher), this is the subject-KMS: the value is
   *  encrypted under the DEK of the scope actually written to (tenant-row
   *  → tenant subject, user-row → user subject). Only on `type: "text"`,
   *  `scope !== "system"` (no subject there), and mutually exclusive with
   *  `encrypted` (kumiko-platform#231/#459). */
  readonly piiEncrypted?: boolean;
  readonly options?: readonly string[];
  readonly bounds?: ConfigBounds;
  // Per-key string-pattern validation for type="text". The value must match
  // the regex at write time — set.write hard-rejects a mismatch with
  // ValidationError("invalid_format"), same posture as bounds. Stored as a
  // serializable {regex, flags} pair (not a RegExp/predicate) so it survives
  // JSON like `bounds`/`options` (feature-manifest, docgen) and compiles per
  // write via new RegExp. Keep patterns anchored + length-bounded: the value
  // is tenant-supplied (untrusted), an unbounded catastrophic-backtracking
  // regex applied to it would be a ReDoS vector.
  readonly pattern?: { readonly regex: string; readonly flags?: string };
  readonly computed?: ConfigComputedFn<T>;
  // Per-Request opt-in. Default false — resolveConfigOrParam wirft für
  // Keys ohne diese Marke, auch wenn der Caller paramValue übergibt. Das
  // zwingt Feature-Devs zur expliziten Entscheidung "dieser Key darf pro
  // Request überschrieben werden" — statt versehentlich zu erlauben dass
  // ein Query-Param jede beliebige Tenant-Config umgeht.
  //
  // Nicht kombinierbar mit type="text" (Boot-Reject) — Text-Werte sind
  // immer gesperrt wegen XSS/SQL/Shell-Risiko, selbst mit Opt-in.
  // Nicht kombinierbar mit encrypted (Boot-Reject) — encrypted Keys
  // werden nicht transient aus Query-Strings heraus gelesen.
  readonly allowPerRequest?: boolean;
  // Tenant must supply a real value before the owning feature works — for
  // text keys an empty/whitespace value counts as unset. Surfaced by
  // config:query:readiness; keep in sync with the feature's requireNonEmpty
  // calls in its build-fn.
  readonly required?: boolean;

  // --- Provisioning-Metadata (optional auf createTenant/System/UserConfig) ---
  // ENV-Var-Name, dessen Wert beim Boot als app-override-Default dieses Keys
  // gebrückt wird. Reiner Fallback — überschreibt keinen gesetzten Row.
  readonly env?: string;
  // false → der geerbte system-row-Wert wird für Tenant-Admins redigiert
  // (cascade.query + values.query): der Tenant sieht weder den Wert noch dass
  // er gesetzt ist, nur den eigenen Override. Greift quell-basiert auf jeden
  // Wert aus der system-row — nicht scope-gebunden; typischer Fall ist ein
  // scope:tenant Key, dessen Plattform-Default in der system-row liegt (SMTP-
  // Creds). Default true = transparente Cascade.
  readonly inheritedToTenant?: boolean;
  // "config" (Default, volle Cascade) oder "secrets" (flach pro (tenant,key)).
  readonly backing?: ConfigBacking;
  // Markiert den Key als user-facing Einstellung: der Self-Populating
  // Settings-Hub leitet daraus automatisch Screen+Nav-Eintrag ab (kein
  // manuelles r.screen/r.nav). Fehlt `mask`, gilt der Key als internes
  // Plumbing (ENV-provisioniert/computed) und erscheint NICHT im Hub.
  readonly mask?: ConfigMask;
  // Überschreibt, unter welchem Settings-Hub-Namespace/Screen dieser Key
  // gruppiert wird (Default: das deklarierende Feature). Erlaubt einem
  // Feature, seine Keys unter einem fremden oder geteilten Namespace zu
  // bündeln (z.B. viele flache Migrations-Flags unter "tenant-settings"),
  // ohne dass das Ziel-Feature sie kennt. Rührt NICHT an qualifiziertem
  // Namen, Storage, Seeds oder App-Overrides — nur reine UI-Gruppierung.
  // Muss kebab-case sein (Boot-Validierung).
  readonly group?: string;
};

// Label-Träger für den Settings-Hub. `title` ist ein i18n-Key (kein Literal —
// Guard), `icon` ein Icon-Registry-Key für den Nav-Eintrag, `order` die
// Sortier-Gewichtung innerhalb seiner Audience-Gruppe.
export type ConfigMask = {
  readonly title: string;
  readonly icon?: string;
  readonly order?: number;
};

export type ConfigDefinition = {
  readonly keys: Readonly<Record<string, ConfigKeyDefinition>>;
};

export type ConfigKeyHandle<T extends ConfigKeyType = ConfigKeyType> = {
  readonly name: string;
  readonly type: T;
};

export type ConfigAccessor = {
  (qualifiedKey: string): Promise<string | number | boolean | undefined>;
  <T extends ConfigKeyType>(handle: ConfigKeyHandle<T>): Promise<ConfigValue<T> | undefined>;
};

export type ConfigAccessorFactory = (deps: {
  readonly user: { readonly id: string; readonly tenantId: TenantId };
  readonly db: DbConnection | TenantDb;
  // Present when the app wired `extraContext.secrets`. Lets the internal
  // `ctx.config.get` read a backing="secrets" key transparently from the
  // secrets store; absent → a backing="secrets" read throws loud.
  readonly secrets?: ConfigSecretsReader;
}) => ConfigAccessor;

// Row shape returned by ConfigResolver.getAll — just enough for the
// values.query handler to project. Stored as `unknown` value because the
// resolver hands raw JSON strings; deserialization is the resolver's job.
//
// Post-ES the config_values projection PK is a UUID (event-store aggregate
// id) and tenantId is non-null (system-scope rows carry SYSTEM_TENANT_ID).
// The shape stays backward-compatible for read callers: they only touch
// `value` and `key`.
export type ConfigStoredRow = {
  readonly id: string;
  readonly key: string;
  readonly value: string | null;
  readonly tenantId: string;
  readonly userId: string | null;
};

// Extended row returned by ConfigResolver.getAllWithSource — includes the
// resolution source so the UI can display where each value came from.
export type ConfigStoredRowWithSource = ConfigStoredRow & {
  readonly source: ConfigValueSource;
};

// Which layer of the cascade actually produced a value. Emitted only by
// `getWithSource` — regular `get` hides this to keep the hot-path simple.
// Use-case: Ops-debugging ("warum ist mein Wert 50 und nicht 100?") without
// poking through six scope-row-lookups by hand.
export type ConfigValueSource =
  | "user-row" // user-scoped row (only for scope:user keys)
  | "tenant-row" // tenant-scoped row
  | "system-row" // system-scoped row (tenantId = SYSTEM_TENANT_ID, userId = null)
  | "app-override" // from createConfigResolver({ appOverrides })
  | "computed" // computed resolver in the key declaration
  | "default" // keyDef.default
  | "missing"; // no row, no override, no computed, no default

export type ConfigValueWithSource = {
  readonly value: string | number | boolean | undefined;
  readonly source: ConfigValueSource;
};

/// Full cascade for a single config key — every level the resolver
/// walks through, with the winning level marked.
export type ConfigCascadeLevel = {
  readonly label: string;
  readonly value: string | number | boolean | undefined;
  readonly source: ConfigValueSource;
  readonly isActive: boolean;
  readonly hasValue: boolean;
};

export type ConfigCascade = {
  readonly value: string | number | boolean | undefined;
  readonly source: ConfigValueSource;
  readonly levels: readonly ConfigCascadeLevel[];
};

// Minimal contract handlers (set/reset/values.query) call against the
// resolver. Lives in the framework so SharedContextFields.configResolver
// can drop the `unknown` cast — the concrete implementation in
// bundled-features/config/resolver.ts implements this shape.
// Read-only contract: writes flow through the config feature's
// write-handlers (set / reset), which append events + let the event-store-
// executor materialise the projection. The resolver is purely a read
// cascade (user → tenant → system → app-override → computed → default).
export type ConfigResolver = {
  get(
    qualifiedKey: string,
    keyDef: ConfigKeyDefinition,
    tenantId: TenantId,
    userId: string,
    db: DbConnection | TenantDb,
    secretsReader?: ConfigSecretsReader,
  ): Promise<string | number | boolean | undefined>;

  // Same cascade as get() but also reports which layer produced the value.
  // Intended for Ops/Support tooling — never call this from hot-path
  // handlers (it builds the source tag even when the caller doesn't look
  // at it). Row-lookup count is identical to get(); the extra work is a
  // small branch tag.
  getWithSource(
    qualifiedKey: string,
    keyDef: ConfigKeyDefinition,
    tenantId: TenantId,
    userId: string,
    db: DbConnection | TenantDb,
    secretsReader?: ConfigSecretsReader,
  ): Promise<ConfigValueWithSource>;

  getAll(
    tenantId: TenantId,
    userId: string,
    db: DbConnection | TenantDb,
  ): Promise<ReadonlyMap<string, ConfigStoredRow>>;

  // Like getAll() but also reports the resolution source for each key.
  // Use when the caller needs to display the cascade origin (e.g. the
  // values.query handler serves the UI's hierarchy badge). Hot-path
  // callers should prefer getAll() for the narrower return type.
  getAllWithSource(
    tenantId: TenantId,
    userId: string,
    db: DbConnection | TenantDb,
  ): Promise<ReadonlyMap<string, ConfigStoredRowWithSource>>;

  // Returns ALL cascade levels for a single key — not just the winner.
  // Each level shows its value (or undefined if not set) and whether it
  // is the active/winning level. Levels are ordered by specificity
  // descending (most specific first).
  getCascade(
    qualifiedKey: string,
    keyDef: ConfigKeyDefinition,
    tenantId: TenantId,
    userId: string,
    db: DbConnection | TenantDb,
    secretsReader?: ConfigSecretsReader,
  ): Promise<ConfigCascade>;

  // Batch variant: resolves cascades for N keys in one DB round-trip.
  // keyDefs must contain definitions for every key in the keys array.
  // Returns a map of qualifiedKey → ConfigCascade. backing="secrets" keys
  // resolve their system rung from the secrets store via secretsReader
  // (one read each — they are system-only and rare).
  getCascadeBatch(
    keys: readonly string[],
    keyDefs: ReadonlyMap<string, ConfigKeyDefinition>,
    tenantId: TenantId,
    userId: string,
    db: DbConnection | TenantDb,
    secretsReader?: ConfigSecretsReader,
  ): Promise<ReadonlyMap<string, ConfigCascade>>;
};

// --- Process-Placement (runIn) ---

// Which deploy-shape a consumer / job is allowed to run in. Filtered at
// entrypoint boot: createApiEntrypoint picks up "api"|"both", createWorker
// Entrypoint picks up "worker"|"both", createAllInOneEntrypoint takes
// everything. Default is "worker" for every async consumer/job — that's the
// sensible prod default (API instances stay request-focused, heavy async
// work lives on the worker fleet). Opt into "api" only for latency-
// sensitive or in-memory-stateful consumers (e.g. later: SSE per-instance
// push in Welle 2.7).
//
// Feature-hooks (r.hook preSave/postSave/…) intentionally have no runIn —
// they run in-TX in whatever process handles the command. Splitting them
// would break atomicity. If you want async work, use r.job or
// r.multiStreamProjection.
export type RunIn = "api" | "worker" | "both";

// Jobs are queue-delivered via BullMQ with one dedicated queue per lane
// ("kumiko-jobs-api" vs "kumiko-jobs-worker") and one dedicated event-
// enqueuer consumer per lane. "both" would mean "dispatch to both queues",
// which over-delivers the job; the Marten-style cursor/queue fan-out is not
// free. Restrict at the type level so the boot-validator never has to
// report it.
export type JobRunIn = Exclude<RunIn, "both">;

// --- Jobs ---

export type JobHandlerFn = (payload: Record<string, unknown>, context: AppContext) => Promise<void>;

export type JobTrigger =
  // `on` akzeptiert ein einzelnes Handler-Ref ODER eine Liste. Multi-
  // Trigger-Form ist DRY für Fanout-Patterns: ein Job-Body, mehrere
  // Trigger (z.B. webhook-fanout: incident.open / incident.update /
  // maintenance.start) statt N r.job-Calls mit demselben Handler-Body.
  // Im Handler-payload landet `_triggerName: string` damit der Code
  // weiß, welcher Trigger gefeuert hat.
  | { readonly on: import("./handlers").NameOrRef | readonly import("./handlers").NameOrRef[] }
  | { readonly cron: string }
  | { readonly manual: true };

export type JobDefinition = {
  readonly name: string;
  readonly handler: JobHandlerFn;
  readonly trigger: JobTrigger;
  readonly concurrency?: ConcurrencyMode | undefined;
  readonly maxPerTenant?: number | undefined;
  readonly debounceMs?: number | undefined;
  readonly retries?: number | undefined;
  readonly backoff?: "fixed" | "exponential" | undefined;
  readonly timeout?: number | undefined;
  readonly schema?: ZodType | undefined;
  readonly runOnBoot?: boolean | undefined;
  readonly perTenant?: boolean | undefined;
  // Which deploy-lane runs this job. Default "worker". Set "api" only for
  // short CPU-light handlers (token cleanup, in-process cache warmup) that
  // don't justify a separate worker container — long/CPU-heavy jobs on the
  // API lane will starve request handlers.
  readonly runIn?: JobRunIn | undefined;
};

// --- Notifications ---

export type NotificationRecipientFn = (
  result: import("./hooks").SaveContext,
) => string | readonly string[] | { readonly tenant: string } | null;

export type NotificationDataFn = (result: import("./hooks").SaveContext) => Record<string, unknown>;

// Per-channel template function: transforms raw notification data into channel-specific format.
// Example: inApp gets { title, body }, email gets { subject, sections }.
export type NotificationTemplateFn = (data: Record<string, unknown>) => Record<string, unknown>;

export type NotificationDefinition = {
  readonly name: string;
  readonly trigger: { readonly on: string };
  readonly recipient: NotificationRecipientFn;
  readonly data: NotificationDataFn;
  readonly templates: Readonly<Record<string, NotificationTemplateFn>> | undefined;
};

// --- Translations ---

export type TranslationEntry = Readonly<Record<string, string>>;
export type TranslationKeys = Readonly<Record<string, TranslationEntry>>;

export type TranslationsDef = {
  readonly keys: TranslationKeys;
};

// --- Registrar Extensions ---

export type RegistrarExtensionHooks = {
  readonly preSave?: PreSaveHookFn;
  readonly postSave?: PostSaveHookFn;
  readonly preDelete?: PreDeleteHookFn;
  readonly postDelete?: PostDeleteHookFn;
  readonly preQuery?: PreQueryHookFn;
};

export type UiExtensionDef = {
  readonly editSection?: string;
  readonly listColumns?: string;
  readonly filters?: string;
};

export type RegistrarExtensionDef = {
  readonly onRegister?: (entityName: string, options?: Record<string, unknown>) => void;
  readonly extendSchema?: (entityName: string) => Record<string, FieldDefinition>;
  readonly hooks?: RegistrarExtensionHooks;
  readonly extendSearch?: (entityName: string) => Record<string, unknown>;
  readonly uiExtension?: UiExtensionDef;
};

export type RegistrarExtensionRegistration = {
  readonly extensionName: string;
  readonly entityName: string;
  readonly options?: Record<string, unknown> | undefined;
  // Owning feature — annotated by the registry at merge time so consumers
  // (readiness gating) can map a registration back to the feature's keys.
  readonly featureName?: string;
};

// Declared by the extension-point-owning foundation via r.extensionSelector:
// "which provider under <extensionName> is active is chosen by <qualifiedKey>".
// Readiness counts a provider-feature's required keys only when selected.
export type ExtensionSelectorDef = {
  readonly extensionName: string;
  readonly qualifiedKey: string;
};

// --- Reference Data ---

export type ReferenceDataDef = {
  readonly entityName: string;
  readonly data: readonly Record<string, unknown>[];
  readonly upsertKey?: string | undefined;
};

// --- Config Seeding ---

// A deploy-time default for a config key, written via the event-store
// executor at boot. Idempotent — if the stream already exists the executor
// returns version_conflict and seedConfigValues counts it as skipped.
// See config-seeding.md.
//
// `scope` is optional on the factory-output: createSeed leaves it unset
// (define-feature derives it from keyDef.scope). createSystemSeed /
// createTenantSeed / createUserSeed always set it explicitly.
//
// `tenantId` / `userId` semantics:
//   - system scope: both stay undefined (row stored under SYSTEM_TENANT_ID).
//   - tenant scope: tenantId optional (undefined → fallback row under
//     SYSTEM_TENANT_ID, visible to all tenants via resolver cascade).
//   - user scope: BOTH tenantId AND userId required, otherwise the resolver
//     can never match the row (user-scope cascade looks up the user's actual
//     tenantId, not SYSTEM_TENANT_ID).
export type ConfigSeedDef = {
  readonly key: string; // fully-qualified config key name (set by define-feature)
  readonly value: string | number | boolean;
  readonly scope?: ConfigScope;
  readonly tenantId?: string;
  readonly userId?: string;
};

// Factory types for ergonomic seed creation in r.config({ seeds }).

export type CreateSeedOptions = {
  readonly value: string | number | boolean;
};

export type CreateTenantSeedOptions = {
  readonly tenantId?: string;
};

export type CreateUserSeedOptions = {
  readonly tenantId: string;
  readonly userId: string;
};
