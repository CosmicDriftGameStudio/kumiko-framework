import type {
  ConfigCascade,
  ConfigCascadeLevel,
  ConfigKeyDefinition,
  ConfigValueSource,
} from "@cosmicdrift/kumiko-framework/engine";

const SYSTEM_ADMIN_ROLE = "SystemAdmin";

// The viewer's own cascade rungs. Every other rung (system-row, app-override,
// computed, default) carries a platform-inherited value — for an
// inheritedToTenant:false key those must stay hidden from a tenant-side viewer.
const OWN_SOURCES: ReadonlySet<ConfigValueSource> = new Set(["user-row", "tenant-row"]);

// A SystemAdmin owns the platform-level values and may always see them. Every
// other viewer (TenantAdmin, User) is tenant-side — for an
// inheritedToTenant:false key they must learn neither the inherited platform
// value nor that it is set.
export function mayViewInheritedValue(roles: readonly string[]): boolean {
  return roles.includes(SYSTEM_ADMIN_ROLE);
}

export function shouldRedactInherited(
  keyDef: Pick<ConfigKeyDefinition, "inheritedToTenant">,
  roles: readonly string[],
): boolean {
  return keyDef.inheritedToTenant === false && !mayViewInheritedValue(roles);
}

// Strips every platform-inherited level (system-row, app-override, computed,
// default — anything that is not the viewer's own user-/tenant-row) so a
// tenant-side viewer sees an inheritedToTenant:false key as if no platform
// value existed, then recomputes the winning level among the survivors. A
// no-op when the cascade carries no inherited value.
export function redactInheritedCascade(cascade: ConfigCascade): ConfigCascade {
  let redacted = false;
  const levels: ConfigCascadeLevel[] = cascade.levels.map((level) => {
    if (!OWN_SOURCES.has(level.source) && level.hasValue) {
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
