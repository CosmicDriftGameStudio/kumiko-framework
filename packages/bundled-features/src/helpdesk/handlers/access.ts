export const REPORT_ACCESS = {
  openToAll: {
    reason:
      "every signed-in user may report a problem; name, email and tenant come from the session and the request is bound to the caller's own userId",
    personalData: "tenant-members",
  },
} as const;
