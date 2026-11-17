import {
  access,
  createSystemConfig,
  defineFeature,
  type FeatureDefinition,
  i18nKey,
  SYSTEM_USER_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { accessLogTableMeta, pruneExpiredAccessLog } from "./access-log.ts";
import { escapeHatchUsedSchema } from "./escape-hatch-audit-sink.ts";
import { accessLogQuery } from "./handlers/access-log.query.ts";
import { detailsQuery } from "./handlers/details.query.ts";
import { detailsAllTenantsQuery } from "./handlers/details-all-tenants.query.ts";
import { listQuery } from "./handlers/list.query.ts";
import { listAllTenantsQuery } from "./handlers/list-all-tenants.query.ts";
import { runEscapeHatchRetention } from "./run-escape-hatch-retention.ts";
import {
  AUDIT_LOG_ALL_TENANTS_COLUMNS,
  AUDIT_LOG_COLUMNS,
  AUDIT_LOG_DATE_RANGE_FACET,
  AUDIT_LOG_DETAIL_FIELD_LABELS,
  AUDIT_LOG_TECHNICAL_FACET,
  AUDIT_LOG_TENANT_FACET,
  auditLogDetailLayout,
} from "./screens.ts";
import {
  AUDIT_LOG_ALL_TENANTS_DETAIL_SCREEN_ID,
  AUDIT_LOG_ALL_TENANTS_NAV_ID,
  AUDIT_LOG_ALL_TENANTS_SCREEN_ID,
  AUDIT_LOG_DETAIL_SCREEN_ID,
  AUDIT_LOG_SCREEN_ID,
  AuditQueries,
  DEFAULT_ESCAPE_HATCH_RETENTION_DAYS,
} from "./web/constants.ts";
import { AUDIT_I18N } from "./web/i18n.ts";

// Audit feature — exposes a filtered read over the framework's event log.
//
// Design: the event-store IS the audit trail for writes (every entity write
// produces an event with who/when/what/where/delta); the list queries read the
// existing `events` table, see handlers/list.query.ts for the filter surface.
// Read accesses are no state change and land in the access log
// `store_access_log` (recordAccess), pruned per tenant after the compliance
// profile's auditLog.retention (minimal profile without compliance-profiles).
//
// Retention: `escapeHatchUse` events are pruned (daily job, config key
// `escapeHatchRetentionDays`). All other events stay as the source of truth
// for state; archive or compress policies are a separate concern (tracked
// with the snapshot/archive infrastructure that already exists in the
// framework).
export function createAuditFeature(): FeatureDefinition {
  return defineFeature(
    "audit",
    (r) => {
      r.describe(
        "Exposes the framework's event store as a paginated, filterable audit log via the `audit:query:list` handler (accessible to `Admin` and `SystemAdmin` roles). Write history comes from the event store: every entity write already records who, when, what entity, and the event payload with PII stripped. A SystemAdmin can pass `scope: \"system\"` to read the app-instance system events such as `app.started`, and reads the events of every tenant (system tenant excluded) through `audit:query:list-all-tenants` and the `audit-log-all-tenants` screen. Filter by `aggregateType`, `aggregateId`, `eventType`, `userId`, or time range. Also records `audit:event:escape-hatch-used` whenever a handler uses one of the framework's escape hatches (unsafeRaw, acknowledgeCrossTenant, db.global() writes, or a granted identity switch). Read accesses that need proof (e.g. a portal link opened) are recorded with `recordAccess(ctx, { subjectType, subjectId, action, details })` from `@cosmicdrift/kumiko-bundled-features/audit` into the `store_access_log` table outside the caller's transaction, readable by admins through `audit:query:access-log` and pruned per tenant after the compliance profile's audit-log retention (minimal profile without compliance-profiles) by the maintenance job `audit:job:access-log-retention`.",
      );
      r.uiHints({
        displayLabel: "Audit Log",
        category: "compliance",
        recommended: false,
      });
      r.translations({ keys: AUDIT_I18N });
      // The all-tenants queries read through ctx.systemDb.acknowledgeCrossTenant; the own-tenant
      // queries use assertTenantMatch on the same handle.
      r.systemScope();
      r.requires({ features: ["tenant", "user", "config"] });

      // Registered so ops tools/MSPs can discover the type — escape-hatch-audit-sink.ts appends it via the low-level event-store API.
      r.defineEvent("escape-hatch-used", escapeHatchUsedSchema, { piiFields: "none" });

      r.config(
        "escapeHatchRetentionDays",
        createSystemConfig("number", {
          default: DEFAULT_ESCAPE_HATCH_RETENTION_DAYS,
          bounds: { min: 1 },
        }),
      );

      r.job({
        name: "escape-hatch-retention",
        trigger: { maintenance: true },
        concurrency: "skip",
        // pruneEvents needs a transaction-capable connection, which only unsafeRaw() hands a job.
        escapeHatch: {
          reason: "prunes expired escapeHatchUse audit events through pruneEvents",
          grants: ["unsafeRaw"],
        },
        handler: async (_payload, ctx) => {
          if (!ctx.registry) {
            throw new Error(
              "escape-hatch-retention: ctx.registry required (JobContext incomplete)",
            );
          }
          await runEscapeHatchRetention({
            db: ctx.db.unsafeRaw(),
            registry: ctx.registry,
            configResolver: ctx.services.configResolver,
            userId: SYSTEM_USER_ID,
          });
        },
      });

      r.storeTable(accessLogTableMeta, { reason: "audit.access_log_append_only_with_retention" });
      r.job({
        name: "access-log-retention",
        trigger: { maintenance: true },
        perTenant: true,
        concurrency: "skip",
        handler: async (_payload, ctx) => {
          await pruneExpiredAccessLog({
            db: ctx.db,
            registry: ctx.registry,
            tenantId: ctx.systemUser.tenantId,
            now: ctx.tz.now(),
          });
        },
      });

      const queries = {
        accessLog: r.queryHandler(accessLogQuery),
        list: r.queryHandler(listQuery),
        details: r.queryHandler(detailsQuery),
        listAllTenants: r.queryHandler(listAllTenantsQuery),
        detailsAllTenants: r.queryHandler(detailsAllTenantsQuery),
      };

      r.screen({
        id: AUDIT_LOG_SCREEN_ID,
        type: "projectionList",
        query: AuditQueries.list,
        columns: AUDIT_LOG_COLUMNS,
        searchable: true,
        defaultSort: { field: "createdAt", dir: "desc" },
        facets: [AUDIT_LOG_DATE_RANGE_FACET, AUDIT_LOG_TECHNICAL_FACET],
        rowActions: [
          {
            kind: "navigate",
            id: "details",
            label: i18nKey("audit.log.details"),
            screen: AUDIT_LOG_DETAIL_SCREEN_ID,
            entityId: "id",
            rowClick: true,
          },
        ],
        pagination: "infinite",
        description: "audit.log.description",
        access: { roles: access.admin },
      });
      r.screen({
        id: AUDIT_LOG_DETAIL_SCREEN_ID,
        type: "projectionDetail",
        query: AuditQueries.details,
        idParam: "id",
        fieldLabels: AUDIT_LOG_DETAIL_FIELD_LABELS,
        layout: auditLogDetailLayout({ withTenant: false }),
        description: "audit.log.detail.subtitle",
        listScreenId: AUDIT_LOG_SCREEN_ID,
        access: { roles: access.admin },
      });
      r.screen({
        id: AUDIT_LOG_ALL_TENANTS_SCREEN_ID,
        type: "projectionList",
        query: AuditQueries.listAllTenants,
        columns: AUDIT_LOG_ALL_TENANTS_COLUMNS,
        defaultSort: { field: "createdAt", dir: "desc" },
        facets: [AUDIT_LOG_DATE_RANGE_FACET, AUDIT_LOG_TENANT_FACET, AUDIT_LOG_TECHNICAL_FACET],
        rowActions: [
          {
            kind: "navigate",
            id: "details",
            label: i18nKey("audit.log.details"),
            screen: AUDIT_LOG_ALL_TENANTS_DETAIL_SCREEN_ID,
            entityId: "id",
            rowClick: true,
          },
        ],
        pagination: "infinite",
        description: "audit.log.allTenants.description",
        access: { roles: access.systemAdmin },
      });
      r.screen({
        id: AUDIT_LOG_ALL_TENANTS_DETAIL_SCREEN_ID,
        type: "projectionDetail",
        query: AuditQueries.detailsAllTenants,
        idParam: "id",
        fieldLabels: {
          ...AUDIT_LOG_DETAIL_FIELD_LABELS,
          tenantId: i18nKey("audit.log.col.tenant"),
        },
        layout: auditLogDetailLayout({ withTenant: true }),
        description: "audit.log.detail.subtitle",
        listScreenId: AUDIT_LOG_ALL_TENANTS_SCREEN_ID,
        access: { roles: access.systemAdmin },
      });
      r.nav({
        id: "audit-log",
        label: "audit:nav.auditLog",
        icon: "file",
        screen: "audit:screen:audit-log",
        order: 30,
        adminArea: "tenant",
      });
      r.nav({
        id: AUDIT_LOG_ALL_TENANTS_NAV_ID,
        label: "audit:nav.auditLogAllTenants",
        icon: "file",
        screen: "audit:screen:audit-log-all-tenants",
        order: 31,
        adminArea: "platform",
      });

      return { queries };
    },
    { dedupeOptions: {} },
  );
}
