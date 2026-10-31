import { access } from "@cosmicdrift/kumiko-framework/engine";

// Logged-in callers carry no anonymous role, so every signed-in role must be listed.
export const SUBMIT_ROLES = access.roles(
  ...access.anonymous,
  ...access.authenticated,
  "Member",
  "TenantAdmin",
);

export const REPORT_ACCESS = {
  openToAll: {
    reason:
      "every signed-in user may report a problem; name, email and tenant come from the session and the request is bound to the caller's own userId",
    personalData: "tenant-members",
  },
} as const;
