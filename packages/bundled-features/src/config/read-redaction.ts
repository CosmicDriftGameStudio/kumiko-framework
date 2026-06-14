import type {
  ConfigCascade,
  ConfigCascadeLevel,
  ConfigKeyDefinition,
} from "@cosmicdrift/kumiko-framework/engine";

const SYSTEM_ADMIN_ROLE = "SystemAdmin";

// A SystemAdmin owns the platform-level (system-row) value and may always see
// it. Every other viewer (TenantAdmin, User) is tenant-side — for an
// inheritedToTenant:false key they must learn neither the inherited system
// value nor that it is set.
export function mayViewInheritedSystemValue(roles: readonly string[]): boolean {
  return roles.includes(SYSTEM_ADMIN_ROLE);
}

export function shouldRedactInheritedSystem(
  keyDef: Pick<ConfigKeyDefinition, "inheritedToTenant">,
  roles: readonly string[],
): boolean {
  return keyDef.inheritedToTenant === false && !mayViewInheritedSystemValue(roles);
}

// Strips the system-row level of a cascade (value AND hasValue) so a tenant-
// side viewer sees the key as if no platform value existed, then recomputes
// the winning level among the survivors. A no-op when the cascade carries no
// system-row value.
export function redactInheritedSystemCascade(cascade: ConfigCascade): ConfigCascade {
  let redacted = false;
  const levels: ConfigCascadeLevel[] = cascade.levels.map((level) => {
    if (level.source === "system-row" && level.hasValue) {
      redacted = true;
      return { ...level, value: undefined, hasValue: false, isActive: false };
    }
    return { ...level, isActive: false };
  });
  if (!redacted) return cascade;

  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    if (level?.hasValue) {
      levels[i] = { ...level, isActive: true };
      return { value: level.value, source: level.source, levels };
    }
  }
  return { value: undefined, source: "missing", levels };
}
