import { access } from "@cosmicdrift/kumiko-framework/engine";

// Logged-in callers carry no anonymous role, so every signed-in role must be listed.
export const SUBMIT_ROLES = access.roles(
  ...access.anonymous,
  ...access.authenticated,
  "Member",
  "TenantAdmin",
);

export const AUTHENTICATED_ROLES = access.roles(...access.authenticated, "Member", "TenantAdmin");
