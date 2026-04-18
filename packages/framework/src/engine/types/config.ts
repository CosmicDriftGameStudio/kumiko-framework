import type { ZodType } from "zod";
import type { DbConnection } from "../../db/connection";
import type { TenantDb } from "../../db/tenant-db";
import type { ConcurrencyMode, ConfigScope } from "../constants";
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

export type ConfigKeyDefinition<T extends ConfigKeyType = ConfigKeyType> = {
  readonly type: T;
  readonly default?: ConfigValue<T>;
  readonly scope: ConfigScope;
  readonly access: ConfigKeyAccess;
  readonly encrypted?: boolean;
  readonly options?: readonly string[];
  readonly bounds?: ConfigBounds;
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
}) => ConfigAccessor;

// Row shape returned by ConfigResolver.getAll — just enough for the
// values.query handler to project. Stored as `unknown` value because the
// resolver hands raw JSON strings; deserialization is the resolver's job.
export type ConfigStoredRow = {
  readonly id: number;
  readonly key: string;
  readonly value: string | null;
  readonly tenantId: string | null;
  readonly userId: string | null;
};

// Minimal contract handlers (set/reset/values.query) call against the
// resolver. Lives in the framework so SharedContextFields.configResolver
// can drop the `unknown` cast — the concrete implementation in
// core-features/config/resolver.ts implements this shape.
export type ConfigResolver = {
  get(
    qualifiedKey: string,
    keyDef: ConfigKeyDefinition,
    tenantId: TenantId,
    userId: string,
    db: DbConnection | TenantDb,
  ): Promise<string | number | boolean | undefined>;

  set(
    qualifiedKey: string,
    keyDef: ConfigKeyDefinition,
    value: string | number | boolean,
    tenantId: string | null,
    userId: string | null,
    modifiedById: string,
    db: DbConnection | TenantDb,
  ): Promise<void>;

  reset(
    qualifiedKey: string,
    tenantId: string | null,
    userId: string | null,
    db: DbConnection | TenantDb,
  ): Promise<void>;

  getAll(
    tenantId: TenantId,
    userId: string,
    db: DbConnection | TenantDb,
  ): Promise<ReadonlyMap<string, ConfigStoredRow>>;
};

// --- Jobs ---

export type JobHandlerFn = (payload: Record<string, unknown>, context: AppContext) => Promise<void>;

export type JobTrigger =
  | { readonly on: import("./handlers").NameOrRef }
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
};

// --- Reference Data ---

export type ReferenceDataDef = {
  readonly entityName: string;
  readonly data: readonly Record<string, unknown>[];
  readonly upsertKey?: string | undefined;
};
