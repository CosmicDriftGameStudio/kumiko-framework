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

export type ConfigKeyDefinition<T extends ConfigKeyType = ConfigKeyType> = {
  readonly type: T;
  readonly default?: ConfigValue<T>;
  readonly scope: ConfigScope;
  readonly access: ConfigKeyAccess;
  readonly encrypted?: boolean;
  readonly options?: readonly string[];
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
