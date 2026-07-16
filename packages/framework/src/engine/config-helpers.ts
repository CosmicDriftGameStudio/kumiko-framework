import type { ConfigScope } from "./constants";
import { SYSTEM_ROLE } from "./system-user";
import type {
  ConfigBacking,
  ConfigBounds,
  ConfigComputedFn,
  ConfigKeyDefinition,
  ConfigKeyType,
  ConfigMask,
  ConfigSeedDef,
  ConfigValue,
  CreateSeedOptions,
  CreateTenantSeedOptions,
  CreateUserSeedOptions,
} from "./types";

// A key backed by "secrets" is at-rest encrypted by the secrets store itself
// (MasterKeyProvider), even without an explicit `encrypted: true` — callers
// that gate on encryption (boot-validator mutual-exclusion checks, config
// query redaction) must treat the two as equivalent or a secrets-backed key
// silently skips the encrypted-only guard.
export function isEncryptedAtRest(
  def: Pick<ConfigKeyDefinition, "encrypted" | "backing">,
): boolean {
  return def.encrypted === true || def.backing === "secrets";
}

// --- Access Presets ---

export const access = {
  all: ["all"] as readonly string[], // @cast-boundary schema-walk
  // TenantAdmin zusätzlich: bundled-features vergeben "TenantAdmin",
  // App-Repos historisch "Admin" — das Preset deckt beide ab, sonst
  // driftet die writeRole-Spalte der Feature-Reference (Manifest 243/2).
  admin: ["TenantAdmin", "Admin", "SystemAdmin"] as readonly string[], // @cast-boundary schema-walk
  systemAdmin: ["SystemAdmin"] as readonly string[], // @cast-boundary schema-walk
  system: ["system"] as readonly string[], // @cast-boundary schema-walk
  privileged: ["system", "SystemAdmin"] as readonly string[], // @cast-boundary schema-walk
  authenticated: ["User", "Admin", "SystemAdmin"] as readonly string[], // @cast-boundary schema-walk
  anonymous: ["anonymous"] as readonly string[], // @cast-boundary schema-walk
  roles: (...roles: string[]): readonly string[] => roles,
  // Tenant self-service roles PLUS the system actor — for tenant-scope keys a
  // tenant edits itself (configEdit) but that provisioning/migration/jobs must
  // also set via ctx.systemWriteAs (roles = [SYSTEM_ROLE]). Stays human-writable
  // because checkWriteAccess only collapses to system-only when system is the
  // SOLE writer (humanWriters empty). Composes any preset, so apps with custom
  // roles get the same provisioning path (issue #396).
  withSystem: (roles: readonly string[]): readonly string[] => [SYSTEM_ROLE, ...roles],
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
//
// Provisioning metadata (optional, available on every scope so a key never
// switches factory to gain it):
//   `env`              binds an ENV var as the boot-time default (the
//                      ENV→app-override bridge reads keyDef.env).
//   `inheritedToTenant` default true; false redacts the inherited system
//                      value from tenant-side reads (e.g. SMTP creds).
//   `backing`          storage backing; "secrets" routes the key through the
//                      secrets store. backing×scope rules are enforced at
//                      boot, not by this type (secrets don't cascade).
//   `mask`             marks the key as a user-facing setting → the
//                      Settings-Hub derives its screen+nav. Absent = internal.
type ConfigKeyOptions<T extends ConfigKeyType> = {
  write?: readonly string[];
  read?: readonly string[];
  default?: ConfigValue<T>;
  encrypted?: boolean;
  options?: readonly string[]; // for select type
  bounds?: T extends "number" ? ConfigBounds : never;
  // Regex enforced at write (set.write) — only meaningful for text keys
  // (never for the other type-tags). Use anchored + length-bounded patterns:
  // the value is tenant-supplied, so an unbounded backtracking regex is a
  // ReDoS vector. See ConfigKeyDefinition.pattern.
  pattern?: T extends "text" ? { regex: string; flags?: string } : never;
  computed?: ConfigComputedFn<T>;
  allowPerRequest?: T extends "text" ? never : boolean;
  required?: boolean;
  env?: string;
  inheritedToTenant?: boolean;
  backing?: ConfigBacking;
  mask?: ConfigMask;
};

// --- Scope Defaults ---

const SCOPE_DEFAULTS: Record<ConfigScope, { write: readonly string[]; read: readonly string[] }> = {
  tenant: { write: access.admin, read: access.all },
  system: { write: access.system, read: access.admin },
  user: { write: access.all, read: access.all },
} satisfies Record<ConfigScope, { write: readonly string[]; read: readonly string[] }>;

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
    bounds: opts.bounds as ConfigBounds | undefined, // @cast-boundary schema-walk
    ...(opts.pattern ? { pattern: opts.pattern } : {}),
    computed: opts.computed,
    ...(opts.allowPerRequest === true ? { allowPerRequest: true } : {}),
    ...(opts.required === true ? { required: true } : {}),
    ...(opts.env ? { env: opts.env } : {}),
    ...(opts.inheritedToTenant === false ? { inheritedToTenant: false } : {}),
    ...(opts.backing === "secrets" ? { backing: "secrets" } : {}),
    ...(opts.mask ? { mask: opts.mask } : {}),
  };
}

// --- Public API ---
// Generic on the type-tag so `r.config({keys})` can propagate it into the
// returned `ConfigKeyHandle<T>` — that's what narrows `ctx.config(handle)`.

// @wrapper-known semantic-alias
export function createTenantConfig<T extends ConfigKeyType>(
  type: T,
  opts?: ConfigKeyOptions<T>,
): ConfigKeyDefinition<T> {
  return createConfigKey("tenant", type, opts);
}

// @wrapper-known semantic-alias
export function createSystemConfig<T extends ConfigKeyType>(
  type: T,
  opts?: ConfigKeyOptions<T>,
): ConfigKeyDefinition<T> {
  return createConfigKey("system", type, opts);
}

// @wrapper-known semantic-alias
export function createUserConfig<T extends ConfigKeyType>(
  type: T,
  opts?: ConfigKeyOptions<T>,
): ConfigKeyDefinition<T> {
  return createConfigKey("user", type, opts);
}

// --- Seed Factories ---
//
// `key` is set to "" here — define-feature.ts fills in the qualified name
// from the seeds-record-key during r.config() processing.

// Scope-agnostic seed. The scope is derived from the matching keyDef in
// define-feature.ts (via `seed.scope ?? keyDef.scope`). NOT usable for
// user-scope keys — those need an explicit tenantId+userId, use
// `createUserSeed` instead.
export function createSeed(opts: CreateSeedOptions): ConfigSeedDef {
  return { value: opts.value, key: "" };
}

// System-scope seed. Always writes under SYSTEM_TENANT_ID.
export function createSystemSeed(opts: CreateSeedOptions): ConfigSeedDef {
  return { value: opts.value, scope: "system", key: "" };
}

// Tenant-scope seed. `tenantId` omitted → fallback row under
// SYSTEM_TENANT_ID (visible to all tenants via the resolver cascade).
// Explicit `tenantId` → seed targets that one tenant only.
export function createTenantSeed(
  opts: CreateSeedOptions,
  options?: CreateTenantSeedOptions,
): ConfigSeedDef {
  return {
    value: opts.value,
    scope: "tenant",
    key: "",
    tenantId: options?.tenantId,
  };
}

// User-scope seed. Both tenantId AND userId are required — the resolver
// matches against the user's actual tenantId, so a seed under
// SYSTEM_TENANT_ID would never resolve.
export function createUserSeed(
  opts: CreateSeedOptions,
  options: CreateUserSeedOptions,
): ConfigSeedDef {
  return {
    value: opts.value,
    scope: "user",
    key: "",
    tenantId: options.tenantId,
    userId: options.userId,
  };
}
