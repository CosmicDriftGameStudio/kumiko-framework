// @runtime client
// Pure-Data i18n keys for admin-shell (server r.translations + client pivot).
// Without these keys nav labels and workspace tabs render raw QNs in the shell.

type LocalizedString = { readonly de: string; readonly en: string };

export const ADMIN_SHELL_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:tenant-overview.title": { de: "Übersicht", en: "Overview" },
  "screen:platform-overview.title": { de: "Übersicht", en: "Overview" },
  "admin-shell:workspace.tenant": { de: "Administration", en: "Administration" },
  "admin-shell:workspace.platform": { de: "Plattform", en: "Platform" },
  "admin-shell:nav.tenantOverview": { de: "Übersicht", en: "Overview" },
  "admin-shell:nav.platformOverview": { de: "Übersicht", en: "Overview" },
  "admin-shell:nav.tenants": { de: "Mandanten", en: "Tenants" },
  "admin-shell:nav.tierAdmin": { de: "Tier zuweisen", en: "Assign tier" },
  "admin-shell:overview.tenantTitle": { de: "Administration", en: "Administration" },
  "admin-shell:overview.platformTitle": { de: "Plattform", en: "Platform" },
  "admin-shell:overview.loading": { de: "Lade…", en: "Loading…" },
  "admin-shell:overview.pendingInvitations": {
    de: "Ausstehende Einladungen",
    en: "Pending invitations",
  },
  "admin-shell:overview.members": { de: "Mitglieder", en: "Members" },
  "admin-shell:overview.missingConfig": {
    de: "Fehlende Konfiguration",
    en: "Missing configuration",
  },
  "admin-shell:overview.missingConfigHint": {
    de: "Pflichtfelder in den Einstellungen prüfen",
    en: "Check required settings",
  },
  "admin-shell:overview.tenants": { de: "Mandanten", en: "Tenants" },
  "admin-shell:overview.failedJobs": { de: "Fehlgeschlagene Jobs", en: "Failed jobs" },
  "admin-shell:overview.failedJobsHint": { de: "Job-Runs prüfen", en: "Review job runs" },
};
