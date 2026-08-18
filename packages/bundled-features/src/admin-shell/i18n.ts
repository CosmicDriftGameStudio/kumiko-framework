// @runtime client
// Pure-Data i18n keys for admin-shell (server r.translations + client pivot).
// Without these keys nav labels and workspace tabs render raw QNs in the shell.

type LocalizedString = { readonly en: string };

export const ADMIN_SHELL_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:tenant-overview.title": { en: "Overview" },
  "screen:platform-overview.title": { en: "Overview" },
  "admin-shell:workspace.tenant": { en: "Administration" },
  "admin-shell:workspace.platform": { en: "Platform" },
  "admin-shell:nav.tenantOverview": { en: "Overview" },
  "admin-shell:nav.platformOverview": { en: "Overview" },
  "admin-shell:nav.tenants": { en: "Tenants" },
  "admin-shell:nav.tierAdmin": { en: "Assign tier" },
  "admin-shell:overview.tenantTitle": { en: "Administration" },
  "admin-shell:overview.platformTitle": { en: "Platform" },
  "admin-shell:overview.loading": { en: "Loading…" },
  "admin-shell:overview.pendingInvitations": {
    en: "Pending invitations",
  },
  "admin-shell:overview.members": { en: "Members" },
  "admin-shell:overview.missingConfig": {
    en: "Missing configuration",
  },
  "admin-shell:overview.missingConfigHint": {
    en: "Check required settings",
  },
  "admin-shell:overview.tenants": { en: "Tenants" },
  "admin-shell:overview.users": { en: "Users" },
  "admin-shell:overview.failedJobs": { en: "Failed jobs" },
  "admin-shell:overview.failedJobsHint": { en: "Review job runs" },
};
