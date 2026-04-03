import type { ConfigKeyDefinition } from "./types";

// --- Access Presets ---

export const access = {
  all: ["all"] as readonly string[],
  admin: ["Admin", "SystemAdmin"] as readonly string[],
  systemAdmin: ["SystemAdmin"] as readonly string[],
  system: ["system"] as readonly string[],
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

// --- Factories ---

export function createTenantConfig(
  type: ConfigKeyDefinition["type"],
  opts: ConfigKeyOptions = {},
): ConfigKeyDefinition {
  return {
    type,
    scope: "tenant",
    access: {
      write: opts.write ?? access.admin,
      read: opts.read ?? access.all,
    },
    ...(opts.default !== undefined ? { default: opts.default } : {}),
    ...(opts.encrypted ? { encrypted: true } : {}),
    ...(opts.options ? { options: opts.options } : {}),
  };
}

export function createSystemConfig(
  type: ConfigKeyDefinition["type"],
  opts: ConfigKeyOptions = {},
): ConfigKeyDefinition {
  return {
    type,
    scope: "system",
    access: {
      write: opts.write ?? access.system,
      read: opts.read ?? access.admin,
    },
    ...(opts.default !== undefined ? { default: opts.default } : {}),
    ...(opts.options ? { options: opts.options } : {}),
  };
}

export function createUserConfig(
  type: ConfigKeyDefinition["type"],
  opts: ConfigKeyOptions = {},
): ConfigKeyDefinition {
  return {
    type,
    scope: "user",
    access: {
      write: opts.write ?? access.all,
      read: opts.read ?? access.all,
    },
    ...(opts.default !== undefined ? { default: opts.default } : {}),
    ...(opts.options ? { options: opts.options } : {}),
  };
}
