import type { AccessRule } from "./handlers.ts";

// AccessRule can arrive from untyped sources (pattern-library JSON, Designer)
// where `openToAll` doesn't actually match the declared union — narrow via
// `unknown` instead of trusting the static type, deny on anything malformed.
export function isOpenToAllGranted(rule: AccessRule): boolean {
  if (!("openToAll" in rule)) return false;
  const openToAll: unknown = rule.openToAll;
  if (typeof openToAll !== "object" || openToAll === null) return false;
  if (!("reason" in openToAll) || typeof openToAll.reason !== "string") return false;
  return openToAll.reason.trim().length > 0;
}

const ANONYMOUS_ACCESS_ROLE = "anonymous";

// UI-visibility predicate — DEFAULT-VISIBLE, the opposite stance from
// `hasAccess` and the default-deny doc on AccessRule (handlers.ts): an unset `access`
// means every signed-in user may see the screen/nav/workspace, not nobody.
// The engine's dispatcher access check stays default-deny; this only
// decides what a client renders/lists, never what a handler accepts.
// Same `unknown`-narrowing caution as isOpenToAllGranted — `access` can
// arrive from untyped sources.
export function isUiAccessGranted(
  access: AccessRule | undefined,
  userRoles: readonly string[] | undefined,
): boolean {
  if (access === undefined) return true;
  if ("openToAll" in access) return isOpenToAllGranted(access);
  if (userRoles === undefined) return false;
  if (!("roles" in access)) return false;
  if (isAnySignedInGranted(access) && !userRoles.includes(ANONYMOUS_ACCESS_ROLE)) return true;
  return access.roles.some((role) => userRoles.includes(role));
}

// Same `unknown`-narrowing caution as isOpenToAllGranted. Only granted next to the
// anonymous role, so a rule can never become "every signed-in user" through this flag.
export function isAnySignedInGranted(rule: AccessRule): boolean {
  if (!("roles" in rule) || !("anySignedIn" in rule)) return false;
  const anySignedIn: unknown = rule.anySignedIn;
  return (
    anySignedIn === true && Array.isArray(rule.roles) && rule.roles.includes(ANONYMOUS_ACCESS_ROLE)
  );
}
