import type { ConfigScope } from "./constants";
import type { ConfigKeyDefinition } from "./types";

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
  roles: (...roles: string[]): readonly string[] => roles,
} as const;

// --- Config Key Options ---

type ConfigKeyOptions = {
  write?: readonly string[];
  read?: readonly string[];
  default?: string | number | boolean;
  encrypted?: boolean;
  options?: readonly string[]; // for select type
};

// --- Scope Defaults ---

const SCOPE_DEFAULTS: Record<ConfigScope, { write: readonly string[]; read: readonly string[] }> = {
  tenant: { write: access.admin, read: access.all },
  system: { write: access.system, read: access.admin },
  user: { write: access.all, read: access.all },
};

// --- Factory ---

function createConfigKey(
  scope: ConfigScope,
  type: ConfigKeyDefinition["type"],
  opts: ConfigKeyOptions = {},
): ConfigKeyDefinition {
  const defaults = SCOPE_DEFAULTS[scope];
  return {
    type,
    scope,
    access: {
      write: opts.write ?? defaults.write,
      read: opts.read ?? defaults.read,
    },
    ...(opts.default !== undefined ? { default: opts.default } : {}),
    ...(opts.encrypted ? { encrypted: true } : {}),
    ...(opts.options ? { options: opts.options } : {}),
  };
}

// --- Public API (preserves existing signatures) ---

export function createTenantConfig(
  type: ConfigKeyDefinition["type"],
  opts?: ConfigKeyOptions,
): ConfigKeyDefinition {
  return createConfigKey("tenant", type, opts);
}

export function createSystemConfig(
  type: ConfigKeyDefinition["type"],
  opts?: ConfigKeyOptions,
): ConfigKeyDefinition {
  return createConfigKey("system", type, opts);
}

export function createUserConfig(
  type: ConfigKeyDefinition["type"],
  opts?: ConfigKeyOptions,
): ConfigKeyDefinition {
  return createConfigKey("user", type, opts);
}
