import { access } from "@cosmicdrift/kumiko-framework/engine";

// The website client sends without a session (credentials: "omit"), so it always arrives as anonymous; the signed-in roles only cover other callers.
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
