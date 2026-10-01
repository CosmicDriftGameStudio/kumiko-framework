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
  "admin-shell:nav.myCaps": { en: "Plans & Caps" },
  "admin-shell:nav.tenantCaps": { en: "Plans & Caps" },
  "admin-shell:overview.kpi.activeTenants": { en: "Active tenants" },
  "admin-shell:overview.kpi.activeUsers7d": { en: "Active users, 7 days" },
  "admin-shell:overview.kpi.activeMembers7d": { en: "Active members, 7 days" },
  "admin-shell:overview.kpi.failedJobs24h": { en: "Failed jobs, 24 h" },
  "admin-shell:overview.kpi.failedDeliveries24h": { en: "Failed deliveries, 24 h" },
  "admin-shell:overview.chart.jobRunsByStatus": { en: "Job runs by status" },
  "admin-shell:overview.chart.deliveriesByChannel": { en: "Deliveries by channel" },
  "admin-shell:overview.chart.auditWrites": { en: "Changes per day" },
  "admin-shell:overview.chart.auditWritesSubtitle": { en: "Audit log, 14 days" },
  "admin-shell:overview.list.recentFailures": { en: "Recent failures" },
  "admin-shell:overview.list.recentFailuresEmpty": { en: "No failures in the selected period" },
  "admin-shell:overview.list.quotas": { en: "Quotas" },
  "admin-shell:overview.list.quotasEmpty": { en: "No quotas configured" },
  "admin-shell:overview.col.job": { en: "Job" },
  "admin-shell:overview.col.startedAt": { en: "Started" },
  "admin-shell:overview.col.failedAt": { en: "Failed at" },
  "admin-shell:overview.col.reason": { en: "Reason" },
  "admin-shell:overview.col.quota": { en: "Quota" },
  "admin-shell:overview.col.used": { en: "Used" },
  "admin-shell:overview.col.limit": { en: "Limit" },
  "admin-shell:overview.col.usage": { en: "Usage" },
  "admin-shell:overview.range.24h": { en: "24 hours" },
  "admin-shell:overview.range.7d": { en: "7 days" },
  "admin-shell:overview.range.30d": { en: "30 days" },
  "admin-shell:overview.scope.badge": { en: "All tenants" },
  "admin-shell:overview.scope.notice": {
    en: "You are viewing data of all tenants. Cross-tenant queries are recorded in the audit log.",
  },
  "admin-shell:overview.filter.tenant": { en: "Tenant" },
  "admin-shell:overview.filter.allTenants": { en: "All tenants" },
};
