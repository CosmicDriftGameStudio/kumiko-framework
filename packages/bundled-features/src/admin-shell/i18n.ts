// @runtime client
// Pure-Data i18n keys for admin-shell (server r.translations + client pivot).
// Without these keys nav labels and workspace tabs render raw QNs in the shell.

type LocalizedString = { readonly de: string; readonly en: string; readonly es: string };

export const ADMIN_SHELL_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:tenant-overview.title": { de: "Übersicht", en: "Overview", es: "Resumen" },
  "screen:platform-overview.title": { de: "Übersicht", en: "Overview", es: "Resumen" },
  "admin-shell:workspace.tenant": {
    de: "Administration",
    en: "Administration",
    es: "Administración",
  },
  "admin-shell:workspace.platform": { de: "Plattform", en: "Platform", es: "Plataforma" },
  "admin-shell:nav.tenantOverview": { de: "Übersicht", en: "Overview", es: "Resumen" },
  "admin-shell:nav.platformOverview": { de: "Übersicht", en: "Overview", es: "Resumen" },
  "admin-shell:nav.tenants": { de: "Mandanten", en: "Tenants", es: "Organizaciones" },
  "admin-shell:nav.tierAdmin": { de: "Tier zuweisen", en: "Assign tier", es: "Asignar tier" },
  "admin-shell:overview.tenantTitle": {
    de: "Administration",
    en: "Administration",
    es: "Administración",
  },
  "admin-shell:overview.platformTitle": { de: "Plattform", en: "Platform", es: "Plataforma" },
  "admin-shell:overview.loading": { de: "Lade…", en: "Loading…", es: "Cargando…" },
  "admin-shell:overview.pendingInvitations": {
    de: "Ausstehende Einladungen",
    en: "Pending invitations",
    es: "Invitaciones pendientes",
  },
  "admin-shell:overview.members": { de: "Mitglieder", en: "Members", es: "Miembros" },
  "admin-shell:overview.missingConfig": {
    de: "Fehlende Konfiguration",
    en: "Missing configuration",
    es: "Configuración incompleta",
  },
  "admin-shell:overview.missingConfigHint": {
    de: "Pflichtfelder in den Einstellungen prüfen",
    en: "Check required settings",
    es: "Revisa los ajustes obligatorios",
  },
  "admin-shell:overview.tenants": { de: "Mandanten", en: "Tenants", es: "Organizaciones" },
  "admin-shell:overview.users": { de: "Benutzer", en: "Users", es: "Usuarios" },
  "admin-shell:overview.failedJobs": {
    de: "Fehlgeschlagene Jobs",
    en: "Failed jobs",
    es: "Trabajos fallidos",
  },
  "admin-shell:overview.failedJobsHint": {
    de: "Job-Runs prüfen",
    en: "Review job runs",
    es: "Revisa las ejecuciones de trabajos",
  },
};
