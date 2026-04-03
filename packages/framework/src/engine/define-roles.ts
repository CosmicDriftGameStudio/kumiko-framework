// Identity function for type-safe role definitions.
// App defines roles once, all features reference them via the typed object.
//
// Usage:
//   const roles = defineRoles(["Admin", "SystemAdmin", "Driver"] as const);
//   roles.Admin     // "Admin" — autocomplete + type-checked
//   roles.Admni     // TS error

type RoleMap<T extends readonly string[]> = {
  readonly [K in T[number]]: K;
};

export function defineRoles<const T extends readonly string[]>(roles: T): RoleMap<T> {
  const map = {} as Record<string, string>;
  for (const role of roles) {
    map[role] = role;
  }
  return map as RoleMap<T>;
}
