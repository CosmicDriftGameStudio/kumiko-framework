import type { ZodType } from "zod";
import type { ConcurrencyMode } from "./concurrency-mode.ts";
import type { ConfigScope } from "./config-scope.ts";
import type { DbConnection } from "./db-connection.ts";
import type { EntityFieldDefinition, OptionsQueryPayload } from "./fields.ts";
import type { EscapeHatchDeclaration, JobContext, JobDeferral } from "./handlers.ts";
import type { PostDeleteHookFn, PostSaveHookFn, PreDeleteHookFn, PreSaveHookFn } from "./hooks.ts";
import type { TenantId } from "./identifiers.ts";
import type { NavIconKey } from "./nav-icon.ts";
import type { DashboardCustomPanel, DashboardScreenPanel } from "./screen.ts";
import type { TenantDb } from "./tenant-db-types.ts";

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

export type ConfigValidateContext = {
  readonly key: string;
  readonly scope: ConfigScope;
  readonly tenantId: TenantId;
  readonly userId: string | null;
  // Tenant-mode handle bound to `tenantId` (the tenant the value is written for): reads see
  // that tenant's rows plus reference data, never other tenants'.
  readonly db: TenantDb;
  // Full cascade of any registered key as seen from `tenantId` / the writing user, e.g. to read
  // an operator default on another level. Throws for an unknown key.
  readonly readCascade: (qualifiedKey: string) => Promise<ConfigCascade>;
};

export type ConfigValidateFn<T extends ConfigKeyType = ConfigKeyType> = (
  value: ConfigValue<T>,
  ctx: ConfigValidateContext,
) => Promise<void>;

// Storage backing for a provisioned config key. "config" (default) =
// config_values projection with the full cascade (user→tenant→system→app→default).
// "secrets" = read_tenant_secrets (flat per (tenant,key), AES-GCM envelope with
// rotation/audit, NO cascade) — meaningful only for scope:system without a
// tenant override. The boot validator enforces the backing×scope matrix.
export type ConfigBacking = "config" | "secrets";

// Minimal read surface the config resolver needs to dispatch a
// backing="secrets" key to the secrets store, without coupling the engine
// types to the full SecretsContext. The app's `ctx.services.secrets` (a SecretsContext)
// is structurally assignable. Threaded per-call (not at resolver construction)
// because the resolver is framework-auto-created while `ctx.services.secrets` is
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
   *  `encrypted`. */
  readonly piiEncrypted?: boolean;
  readonly options?: readonly string[];
  /** Only on `type: "select"`: loads the options from this query (QN), contract
   *  `{ rows: { value, label, description?, group? }[] }`, labels shown verbatim. Mutually exclusive with
   *  `options` and `allowPerRequest`. The write side does not check the value against
   *  the query result; the consuming feature validates it where it uses it. */
  readonly optionsQuery?: string;
  /** Payload sent with every `optionsQuery` call. Requires `optionsQuery`. `{ field }`
   *  names another config key (short name) of the owner feature, resolved on the
   *  generated settings screen. */
  readonly optionsQueryPayload?: OptionsQueryPayload;
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
  // Async write gate: runs in config:write:set after type/bounds/pattern and before
  // persisting, for every scope and backing. Rejects by throwing a KumikoError
  // (ValidationError/UnprocessableError). Not run on reads, env/app-override defaults or
  // boot seeds (seedConfigValues skips bounds/pattern too; seeds are developer-authored
  // and boot must not depend on a validator's I/O).
  // The error reaches the caller unchanged: keep the raw value out of its details for
  // encrypted keys.
  // Runs inside the write transaction, so it holds the dispatcher's DB connection for its whole
  // duration: external I/O (DNS, HTTP) needs its own short timeout, the framework sets none.
  readonly validate?: ConfigValidateFn<T>;
  // Per-request opt-in. Default false — resolveConfigOrParam throws for
  // keys without this marker, even when the caller provides paramValue. This
  // forces feature developers to explicitly decide that "this key may be
  // overridden per request" instead of accidentally allowing a query parameter
  // to bypass any tenant config.
  //
  // Incompatible with type="text" (boot rejection) — text values are always
  // blocked because of XSS/SQL/shell risks, even with opt-in.
  // Incompatible with encrypted (boot rejection) — encrypted keys are not read
  // transiently from query strings.
  readonly allowPerRequest?: boolean;
  // Tenant must supply a real value before the owning feature works — for
  // text keys an empty/whitespace value counts as unset. Surfaced by
  // config:query:readiness; keep in sync with the feature's requireNonEmpty
  // calls in its build-fn.
  readonly required?: boolean;

  // --- Provisioning metadata (optional on createTenant/System/UserConfig) ---
  // ENV variable name whose value is bridged in at boot as this key's
  // app-override default. Pure fallback — it does not override an existing row.
  readonly env?: string;
  // false → the inherited system-row value is redacted for tenant admins
  // (cascade.query + values.query): the tenant sees neither the value nor that
  // it is set, only their own override. Applies source-wide to every value
  // from the system row, not by scope; a typical case is a scope:tenant key
  // whose platform default is in the system row (SMTP credentials). Default
  // true = transparent cascade.
  readonly inheritedToTenant?: boolean;
  // "config" (default, full cascade) or "secrets" (flat per (tenant,key)).
  readonly backing?: ConfigBacking;
  // Marks the key as a user-facing setting: the self-populating Settings Hub
  // derives a screen and navigation entry automatically (no manual
  // r.screen/r.nav). Without `mask`, the key is considered internal plumbing
  // (ENV-provisioned/computed) and does NOT appear in the Hub.
  readonly mask?: ConfigMask;
  // Overrides the Settings Hub namespace/screen under which this key is grouped
  // (default: the declaring feature). This lets a feature group its keys under
  // a foreign or shared namespace (e.g. many flat migration flags under
  // "tenant-settings") without the target feature knowing about them.
  // It does NOT affect the qualified name, storage, seeds, or app overrides —
  // only UI grouping. Must be kebab-case (boot validation).
  readonly group?: string;
};

// Label carrier for the settings hub. `title` is an i18n key (no literal —
// guarded), `icon` a NavIconKey for the nav entry, `order` the sort weight
// within its audience group.
export type ConfigMask = {
  readonly title: string;
  /** i18n key for help text shown under the field label. */
  readonly description?: string;
  readonly icon?: NavIconKey;
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

// Extended row with resolution source so the UI can display where each
// value came from.
export type ConfigStoredRowWithSource = ConfigStoredRow & {
  readonly source: ConfigValueSource;
};

// Which layer of the cascade actually produced a value. Emitted only by
// `getWithSource` — regular `get` hides this to keep the hot-path simple.
// Use case: Ops debugging ("why is my value 50 and not 100?") without
// manually checking six scope-row lookups.
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
// sensitive or in-memory-stateful consumers (for example, a later per-instance
// SSE push).
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

export type JobHandlerFn = (
  payload: Record<string, unknown>,
  context: JobContext,
) => Promise<void | JobDeferral>;

export type JobTrigger =
  // `on` accepts a single handler reference OR a list. The multi-trigger form
  // is DRY for fan-out patterns: one job body, multiple triggers (e.g.
  // webhook-fanout: incident.open / incident.update / maintenance.start)
  // instead of N r.job calls with the same handler body.
  // The handler payload includes `_triggerName: string` so the code knows
  // which trigger fired.
  //
  // Two delivery semantics depend on what `on` resolves to: a write/query-handler
  // QN dispatches synchronously from dispatch-write.ts's afterCommitHooks —
  // effectively once. An r.defineEvent QN (e.g. one an r.multiStreamProjection
  // appends via ctx.events.unsafeAppend) dispatches asynchronously through the
  // job-trigger event consumer (createJobTriggerEventConsumer,
  // pipeline/system-hooks.ts) — cursor delivery, at-least-once. Handlers
  // triggered on an r.defineEvent QN must be idempotent.
  | {
      readonly on: import("./handlers.ts").NameOrRef | readonly import("./handlers.ts").NameOrRef[];
      // Equality filter on top-level payload fields, checked before enqueue —
      // lets N jobs share one broad event QN, partitioned by a discriminant.
      readonly where?: Readonly<Record<string, string | number | boolean>>;
      // Replays the job for every stored event from the beginning of the event
      // store (own consumer `job:<jobQn>`), including events appended before
      // the job existed. A deterministic job id (job QN + event id) makes a
      // redelivery a no-op while the job is still retained in the queue. Every
      // `on` entry must be an r.defineEvent event, not a handler QN. The job
      // is not fired by the synchronous handler path. The job receives the
      // payload upcast to the event's current version. Adding catchUp to a
      // running app runs the job for the whole history of every tenant, so its
      // side effects (mails, webhooks) must be safe to repeat for old events.
      readonly catchUp?: boolean;
    }
  // `tz`: IANA zone the cron fields are read in (default: the server process
  // zone, UTC in the standard containers). A wall-clock
  // time skipped by DST runs once, shifted by the gap; a doubled one runs once, at its first occurrence.
  | { readonly cron: string; readonly tz?: string }
  | { readonly manual: true };

export type JobBackoffStrategy = "fixed" | "exponential";
// String form uses the framework's default base delay; the object form's
// `delayMs` is the base BullMQ multiplies: "fixed" keeps it constant,
// "exponential" scales it delayMs * 2^(attemptsMade-1) per retry.
export type JobBackoff =
  | JobBackoffStrategy
  | { readonly type: JobBackoffStrategy; readonly delayMs?: number | undefined };

// `skip`: an enqueue over the limit is dropped (dispatch returns
// "skipped:max-per-tenant"). `defer`: nothing is dropped; the limit is checked
// when a worker picks the job up, and over the limit the job is moved to delayed
// for `deferMs` (default 1000) and re-checked without consuming a retry attempt.
// The delay grows per deferral up to a cap (30 s) plus jitter. Pick-up order
// (`processedOn`) keeps the cap; only clock skew between workers can briefly let
// one job more through.
export type MaxPerTenantOptions = {
  readonly limit: number;
  readonly onLimit: "skip" | "defer";
  readonly deferMs?: number | undefined;
};

export type JobDefinition = {
  readonly name: string;
  readonly handler: JobHandlerFn;
  readonly trigger: JobTrigger;
  // "sequential" is mutual exclusion, not a FIFO queue: same-name dispatches
  // never run concurrently, but a loser of the per-name lock is re-enqueued
  // to the back of its queue, so a job dispatched later can still complete
  // before one dispatched earlier. Don't rely on dispatch order.
  readonly concurrency?: ConcurrencyMode | undefined;
  // A plain number means `{ limit, onLimit: "skip" }`.
  readonly maxPerTenant?: number | MaxPerTenantOptions | undefined;
  readonly debounceMs?: number | undefined;
  // Upper bound on `ctx.defer` re-runs per job (default 100); exceeding it fails the run.
  readonly maxDefers?: number | undefined;
  readonly retries?: number | undefined;
  readonly backoff?: JobBackoff | undefined;
  readonly timeout?: number | undefined;
  readonly schema?: ZodType | undefined;
  // Enqueue this job once when a runner for its lane starts. Fire-and-forget:
  // the enqueue is awaited, the run is not, so a throwing handler only fails
  // the queue job — the process keeps booting and reports ready.
  // Deduped via a persistent per-queue marker set at enqueue time (not the
  // fixed job id alone, which BullMQ's bounded retention can evict), so it
  // runs at most once per Redis dataset: a boot job that already ran (or
  // failed) is not retried on a later deploy.
  // Never a deploy gate — use `bootGate` for that.
  readonly runOnBoot?: boolean | undefined;
  // Run this job inline while the runner for its lane starts, before cron
  // schedules and `runOnBoot` enqueues. The handler is awaited and a throw
  // rejects the runner's start() — which rejects runProdApp's boot, so the
  // process exits before it ever reports ready. That makes it a real deploy
  // gate, unlike `runOnBoot`. Runs on every start, never deduped.
  // `retries`/`backoff` are BullMQ options and do not apply on the inline
  // path; an explicit `timeout` bounds the gate and rejects start() naming
  // the gate when exceeded; the expired handler is abandoned, not aborted (no
  // AbortSignal reaches it) and keeps running until stop() waits for it, so a
  // gate must tolerate being cut off mid-way. Without `timeout` the gate waits
  // indefinitely and logs a warning naming it after 60s. Incompatible with `perTenant` and `concurrency: "sequential"`.
  // The gate runs wherever a job runner for its lane starts — a setup that
  // starts no runner for that lane runs no gate.
  readonly bootGate?: boolean | undefined;
  readonly perTenant?: boolean | undefined;
  // Which deploy-lane runs this job. Default "worker". Set "api" only for
  // short CPU-light handlers (token cleanup, in-process cache warmup) that
  // don't justify a separate worker container — long/CPU-heavy jobs on the
  // API lane will starve request handlers.
  readonly runIn?: JobRunIn | undefined;
  // Grants `ctx.db.unsafeRaw()` (audited as `unsafe-raw`) and `db.global()` writes (`global-write`) for this job.
  readonly escapeHatch?: EscapeHatchDeclaration | undefined;
  // Opt in to a tenant-visible failure record (`jobs:query:failures`). Only a
  // translation key ever reaches the tenant: a thrown KumikoError's `i18nKey`
  // when it carries one, otherwise `messageKey`. The provider's own message
  // stays in the run log. Only the last attempt records, and a later
  // successful run of the same job and subject clears the record.
  // `subjectFields` names payload fields that scope the record (e.g.
  // `["campaignId", "language"]`); each must hold a primitive or the run
  // throws. Omit it for one record per job and tenant. Their values are
  // stored in clear, unlike the encrypted run payload — never name a PII
  // field here. The `jobs:query:failures` subject filter matches exactly: it
  // needs every declared field, with the same JSON types as the payload.
  readonly tenantVisibleFailure?:
    | {
        readonly messageKey: string;
        readonly subjectFields?: readonly string[] | undefined;
      }
    | undefined;
  // Opt in to a tenant-visible run state (`jobs:query:tenant-runs`): whether a
  // run for a subject is queued or running, with its times, plus the last
  // completed or failed outcome. No payload, error text or logs ever reach the
  // tenant. `subjectFields` works as for `tenantVisibleFailure`: payload
  // fields that scope the state, primitives only, stored in clear — never name
  // a PII field here; the query's subject filter matches exactly.
  readonly tenantVisibleRun?:
    | {
        readonly subjectFields?: readonly string[] | undefined;
      }
    | undefined;
};

// --- Notifications ---

export type NotificationRecipientFn = (
  result: import("./hooks.ts").SaveContext,
) => string | readonly string[] | { readonly tenant: string } | null;

export type NotificationDataFn = (
  result: import("./hooks.ts").SaveContext,
) => Record<string, unknown>;

// Per-channel template function: transforms raw notification data into channel-specific format.
// Example: inApp gets { title, body }, email gets { subject, sections }.
export type NotificationTemplateFn = (data: Record<string, unknown>) => Record<string, unknown>;

// Declared placeholder of a template body. `required` defaults to false. `label`, and the
// `example` of a text or richText variable, is an i18n key or plain text: the editor and the
// preview read it in the language of the edited template.
type TemplateVariableCommon = {
  readonly label?: string;
  readonly required?: boolean;
};

export type TemplateScalarVariableDef =
  | (TemplateVariableCommon & { readonly type: "text"; readonly example?: string })
  | (TemplateVariableCommon & { readonly type: "link"; readonly example?: string })
  | (TemplateVariableCommon & { readonly type: "richText"; readonly example?: string })
  | (TemplateVariableCommon & {
      readonly type: "money";
      readonly example?: number | { readonly amount: number; readonly currency: string };
    })
  | (TemplateVariableCommon & { readonly type: "date"; readonly example?: string })
  // Percentage points: 12 renders as "12 %" (de) or "12%" (en).
  | (TemplateVariableCommon & { readonly type: "percent"; readonly example?: number });

export type TemplateListVariableDef = TemplateVariableCommon & {
  readonly type: "list";
  readonly item: Readonly<Record<string, TemplateScalarVariableDef>>;
  readonly example?: readonly Readonly<Record<string, unknown>>[];
};

// FileRef id or id[] of the record's images; only an images block renders it, never inline text.
export type TemplateImagesVariableDef = TemplateVariableCommon & { readonly type: "images" };

export type TemplateVariableDef =
  | TemplateScalarVariableDef
  | TemplateListVariableDef
  | TemplateImagesVariableDef;

export type TemplateVariables = Readonly<Record<string, TemplateVariableDef>>;

// Per-locale mail metadata of a notification template; mirrors the `mail`
// template meta in template-resolver.
export type NotificationTemplateMeta = {
  readonly subject: string;
  readonly previewText?: string;
  readonly layoutSlug?: string;
  readonly category?: "transactional" | "marketing";
  readonly sender?: string;
  readonly senderName?: string;
  readonly replyTo?: string;
};

export type NotificationTemplateBody = { readonly body: string };

export type NotificationLocalizedTemplate = Readonly<
  Record<string, { readonly body: string; readonly meta: NotificationTemplateMeta }>
>;

// Maps template variables to field paths ("owner.name") of a registered entity
// so a record can fill the variables of a notification template.
export type NotificationRecordMapping = {
  readonly entity: string;
  readonly map: Readonly<Record<string, string>>;
};

// Without a trigger the notification is only sent explicitly via ctx.notify;
// trigger, recipient and data belong together (boot-checked).
export type NotificationDefinition = {
  readonly name: string;
  readonly trigger?: { readonly on: string };
  readonly recipient?: NotificationRecipientFn;
  readonly data?: NotificationDataFn;
  readonly templates: Readonly<Record<string, NotificationTemplateFn>> | undefined;
  readonly variables?: TemplateVariables;
  readonly record?: NotificationRecordMapping;
  readonly template?: Readonly<Record<string, NotificationTemplateBody>>;
  readonly meta?: Readonly<Record<string, NotificationTemplateMeta>>;
  // Former qualified names: stored preferences and address opt-outs under them still apply.
  readonly renamedFrom?: readonly string[];
  // Resolved into template + meta when the registry is built, never present on
  // a stored definition.
  readonly localizedTemplate?: () => NotificationLocalizedTemplate;
  // The stored mail template stays the system default: tenant admins neither see nor override it.
  readonly systemOnly?: boolean;
  // delivery adds a signed data.unsubscribeUrl per recipient, so the mail carries List-Unsubscribe
  // (and one-click) without app code; a caller-supplied unsubscribeUrl wins.
  readonly unsubscribe?: boolean;
  // channel-email sends it through the tenant's own mail transport when the channel has a
  // tenantTransport; every other notification goes through the app transport.
  readonly tenantTransport?: boolean;
};

// --- Translations ---

// CLDR plural categories for one locale's variants of a translation string.
// `other` is the CLDR-mandated fallback and therefore required; the rest
// only exist in some locales (e.g. "few"/"many" for Slavic plurals).
export type PluralForms = {
  readonly zero?: string;
  readonly one?: string;
  readonly two?: string;
  readonly few?: string;
  readonly many?: string;
  readonly other: string;
};
export type TranslationValue = string | PluralForms;
export type TranslationEntry = Readonly<Record<string, TranslationValue>>;
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
};

export type UiExtensionDef = {
  readonly editSection?: string;
  readonly listColumns?: string;
  readonly filters?: string;
};

export type RegistrarExtensionDef = {
  readonly onRegister?: (entityName: string, options?: Record<string, unknown>) => void;
  readonly extendSchema?: (entityName: string) => Record<string, EntityFieldDefinition>;
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
// No `label` on screen panels: the dashboard lives in the "config" namespace, so the key would
// fail the hub i18n check; the embedded screen carries its own title.
export type ExtensionSelectorPanel = DashboardCustomPanel | Omit<DashboardScreenPanel, "label">;

export type ExtensionSelectorDef = {
  readonly extensionName: string;
  readonly qualifiedKey: string;
  // Go onto the selector owner's generated settings dashboard, after the selection
  // panel and before the plugin panels. Only rendered where that dashboard exists
  // (a tenant-masked selector key); `screen` refs are qualified at declaration. A target
  // screen embedded only here has no nav, so it needs `dormant: true`. A `custom` panel is
  // visible to everyone who sees the dashboard: secure its data via its own query's access.
  readonly panels?: readonly ExtensionSelectorPanel[];
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
