import type { ConfigScope } from "./constants";
import type {
  ConfigBounds,
  ConfigComputedFn,
  ConfigKeyDefinition,
  ConfigKeyType,
  ConfigValue,
} from "./types";

// --- Access Presets ---

export const access = {
  all: ["all"] as readonly string[],
  admin: ["Admin", "SystemAdmin"] as readonly string[],
  systemAdmin: ["SystemAdmin"] as readonly string[],
  system: ["system"] as readonly string[],
  // system + SystemAdmin — use for field-access on identity columns that
  // framework auth code (SYSTEM_USER) writes during login/registration, but
  // that a SystemAdmin should also be able to fix manually.
  privileged: ["system", "SystemAdmin"] as readonly string[],
  // Any signed-in user role. Use on authenticated-but-not-privileged handlers
  // (change-password, logout, me-style queries). Does NOT include "system"
  // since an unauthenticated system call shouldn't be able to hit these.
  authenticated: ["User", "Admin", "SystemAdmin"] as readonly string[],
  // Unauthenticated callers reaching public endpoints (server must opt in
  // via `anonymousAccess`). Combine with authenticated roles when an
  // endpoint should serve both — e.g. `roles: ["anonymous", "customer"]`
  // for a product-listing that personalises when a session is present.
  anonymous: ["anonymous"] as readonly string[],
  roles: (...roles: string[]): readonly string[] => roles,
} as const;

// --- Config Key Options ---

// Generic so `default` narrows per type-tag — without it,
// `createUserConfig("boolean", { default: 19 })` would compile.
//
// `bounds` is conditional: only `type="number"` admits it. For any other
// type-tag the field is `never`, so `createTenantConfig("text", { bounds })`
// fails at the call site. Matches the same pattern as `default`.
//
// `computed` is a fallback-resolver the registry calls when no row + no
// app-override exists — used for plan-based limits (see
// configuration-layers.md, "Frage 3: Hängt Geld dran?").
//
// `allowPerRequest` is conditional against `text`: text keys can never
// opt in to per-request overrides (XSS/SQL/Shell risk). For other types
// it's a plain boolean opt-in consumed by resolveConfigOrParam.
type ConfigKeyOptions<T extends ConfigKeyType> = {
  write?: readonly string[];
  read?: readonly string[];
  default?: ConfigValue<T>;
  encrypted?: boolean;
  options?: readonly string[]; // for select type
  bounds?: T extends "number" ? ConfigBounds : never;
  computed?: ConfigComputedFn<T>;
  allowPerRequest?: T extends "text" ? never : boolean;
};

// --- Scope Defaults ---

const SCOPE_DEFAULTS: Record<ConfigScope, { write: readonly string[]; read: readonly string[] }> = {
  tenant: { write: access.admin, read: access.all },
  system: { write: access.system, read: access.admin },
  user: { write: access.all, read: access.all },
};

// --- Factory ---

function createConfigKey<T extends ConfigKeyType>(
  scope: ConfigScope,
  type: T,
  opts: ConfigKeyOptions<T> = {},
): ConfigKeyDefinition<T> {
  const defaults = SCOPE_DEFAULTS[scope];
  return {
    type,
    scope,
    access: {
      write: opts.write ?? defaults.write,
      read: opts.read ?? defaults.read,
    },
    default: opts.default,
    ...(opts.encrypted ? { encrypted: true } : {}),
    ...(opts.options ? { options: opts.options } : {}),
    bounds: opts.bounds as ConfigBounds | undefined,
    computed: opts.computed,
    ...(opts.allowPerRequest === true ? { allowPerRequest: true } : {}),
  };
}

// --- Public API ---
// Generic on the type-tag so `r.config({keys})` can propagate it into the
// returned `ConfigKeyHandle<T>` — that's what narrows `ctx.config(handle)`.

export function createTenantConfig<T extends ConfigKeyType>(
  type: T,
  opts?: ConfigKeyOptions<T>,
): ConfigKeyDefinition<T> {
  return createConfigKey("tenant", type, opts);
}

export function createSystemConfig<T extends ConfigKeyType>(
  type: T,
  opts?: ConfigKeyOptions<T>,
): ConfigKeyDefinition<T> {
  return createConfigKey("system", type, opts);
}

export function createUserConfig<T extends ConfigKeyType>(
  type: T,
  opts?: ConfigKeyOptions<T>,
): ConfigKeyDefinition<T> {
  return createConfigKey("user", type, opts);
}
