import type { AccessRule } from "../engine/types";

// Test-only helper: extracts the role list from a role-based AccessRule,
// narrowing the union safely. Throws when the rule is openToAll or missing —
// the tests that call this always expect roles, and a clear error beats a
// cryptic undefined assertion downstream.
export function rolesOf(access: AccessRule | undefined): readonly string[] {
  if (!access) {
    throw new Error("expected role-based access rule, got undefined");
  }
  if (!("roles" in access)) {
    throw new Error("expected role-based access rule, got openToAll");
  }
  return access.roles;
}
