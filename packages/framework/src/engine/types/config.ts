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

// All allowed type-tags. New tags MUST be added here AND in `ConfigValueFor`
// below — otherwise the generic narrowing for `ctx.config(handle)` breaks
// silently (the value type becomes `never` for the new tag).
export type ConfigKeyType = "text" | "number" | "boolean" | "select";

// Maps a config-key type-tag to the runtime value type ctx.config() resolves
// to. Used by `ConfigKeyHandle<T>` so `await ctx.config(handle)` returns
// `number | undefined` instead of `string | number | boolean | undefined`.
export type ConfigValueFor<T extends ConfigKeyType> = T extends "number"
  ? number
  : T extends "boolean"
    ? boolean
    : T extends "text" | "select"
      ? string
      : never;

// Generic so call-sites that know the type-tag (helpers, r.config()) can
// preserve it through to the handle; default `ConfigKeyType` keeps every
// existing `ConfigKeyDefinition` consumer (registry, handler context, etc.)
// working without type-parameter changes.
export type ConfigKeyDefinition<T extends ConfigKeyType = ConfigKeyType> = {
  readonly type: T;
  readonly default?: ConfigValueFor<T>;
  readonly scope: ConfigScope;
  readonly access: ConfigKeyAccess;
  readonly encrypted?: boolean;
  readonly options?: readonly string[];
};

export type ConfigDefinition = {
  readonly keys: Readonly<Record<string, ConfigKeyDefinition>>;
};

// Returned by `r.config({keys})` — opaque handle that pairs the qualified
// config-key name with its type-tag. Pass it to `ctx.config(handle)` and the
// value type narrows automatically (number for "number", boolean for
// "boolean", etc).
export type ConfigKeyHandle<T extends ConfigKeyType = ConfigKeyType> = {
  readonly name: string;
  readonly type: T;
};

// Pipeline-facing accessor signature. Lives in the framework (instead of
// next to the config feature in core-features) so `HandlerContext.config`
// can carry the typed shape without a cross-package import. The concrete
// accessor is built by `createConfigAccessor` in core-features/config —
// this is just the contract.
export type ConfigAccessorFn = {
  (qualifiedKey: string): Promise<string | number | boolean | undefined>;
  <T extends ConfigKeyType>(handle: ConfigKeyHandle<T>): Promise<ConfigValueFor<T> | undefined>;
};

// Per-request factory that mints a `ConfigAccessorFn` bound to the current
// user + db handle. The dispatcher invokes it inside `buildHandlerContext`
// so each handler gets its own accessor (the resolver can scope by
// tenant + user without the handler having to thread those args through).
// Set on AppContext at boot — the framework calls it, the config feature
// supplies it.
export type ConfigAccessorFactory = (deps: {
  readonly user: { readonly id: string; readonly tenantId: string };
  readonly db: unknown;
}) => ConfigAccessorFn;

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
