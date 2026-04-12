import type { ZodType } from "zod";
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

// --- Config ---

export type ConfigKeyAccess = {
  readonly read: readonly string[];
  readonly write: readonly string[];
};

export type ConfigKeyDefinition = {
  readonly type: "text" | "number" | "boolean" | "select";
  readonly default?: string | number | boolean;
  readonly scope: ConfigScope;
  readonly access: ConfigKeyAccess;
  readonly encrypted?: boolean;
  readonly options?: readonly string[];
};

export type ConfigDefinition = {
  readonly keys: Readonly<Record<string, ConfigKeyDefinition>>;
};

// --- Jobs ---

export type JobHandlerFn = (payload: Record<string, unknown>, context: AppContext) => Promise<void>;

export type JobTrigger =
  | { readonly on: string }
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
