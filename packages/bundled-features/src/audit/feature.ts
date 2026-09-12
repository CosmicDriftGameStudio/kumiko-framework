import {
  access,
  defineFeature,
  type FeatureDefinition,
  i18nKey,
} from "@cosmicdrift/kumiko-framework/engine";
import { AUDIT_LOG_DETAIL_SCREEN_ID, AUDIT_LOG_SCREEN_ID, AuditQueries } from "./constants";
import { detailsQuery } from "./handlers/details.query";
import { listQuery } from "./handlers/list.query";
import { AUDIT_I18N } from "./i18n";

// Audit feature — exposes a filtered read over the framework's event log.
//
// Design: the event-store IS the audit trail (every entity write produces
// an event with who/when/what/where/delta). This feature adds no persistence,
// no projection, no cursor — it's a single privileged query handler over
// the existing `events` table. See handlers/list.query.ts for the filter
// surface.
//
// Retention lives elsewhere. Events are kept indefinitely as the source of
// truth for state; archive or compress policies are a separate concern
// (tracked with the snapshot/archive infrastructure that already exists in
// the framework).
export function createAuditFeature(): FeatureDefinition {
  return defineFeature("audit", (r) => {
    r.describe(
      "Exposes the framework's event store as a paginated, filterable audit log via the `audit:query:list` handler (accessible to `Admin` and `SystemAdmin` roles). No separate table or projection \u2014 the event store is the audit trail by construction: every entity write already records who, when, what entity, and the event payload with PII stripped. Filter by `aggregateType`, `aggregateId`, `eventType`, `userId`, or time range.",
    );
    r.uiHints({
      displayLabel: "Audit Log",
      category: "compliance",
      recommended: false,
    });
    r.translations({ keys: AUDIT_I18N });
    // Screens resolve actor names via tenant:query:members.
    r.requires("tenant");

    const queries = {
      list: r.queryHandler(listQuery),
      details: r.queryHandler(detailsQuery),
    };

    r.screen({
      id: AUDIT_LOG_SCREEN_ID,
      type: "projectionList",
      query: AuditQueries.list,
      columns: [
        {
          field: "createdAt",
          label: i18nKey("audit.log.col.when"),
          renderer: { format: "timestamp" },
        },
        { field: "type", label: i18nKey("audit.log.col.type") },
        { field: "createdBy", label: i18nKey("audit.log.col.actor") },
      ],
      searchable: true,
      defaultSort: { field: "createdAt", dir: "desc" },
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
      description:
        "Admin table of the tenant's audit-trail events with actor names and event-type/date filters; open it to browse recent changes and drill into a single event.",
      access: { roles: access.admin },
    });
    r.screen({
      id: AUDIT_LOG_DETAIL_SCREEN_ID,
      type: "projectionDetail",
      query: AuditQueries.details,
      idParam: "id",
      fieldLabels: {
        type: i18nKey("audit.log.col.type"),
        createdAt: i18nKey("audit.log.col.when"),
        aggregateType: i18nKey("audit.log.col.aggregateType"),
        aggregateId: i18nKey("audit.log.col.aggregateId"),
        createdBy: i18nKey("audit.log.col.actor"),
        id: i18nKey("audit.log.detail.field.id"),
        payload: i18nKey("audit.log.detail.payload"),
        metadata: i18nKey("audit.log.detail.metadata"),
      },
      layout: {
        sections: [
          {
            fields: [
              "type",
              { field: "createdAt", renderer: { format: "timestamp" } },
              "aggregateType",
              "aggregateId",
              "createdBy",
              "id",
            ],
          },
          // No section `title` here (fw#2312 label-dedup fix): each section
          // holds exactly one field, so a title would repeat the field's own
          // label (rendered by RenderField as the Field's heading) verbatim.
          {
            fields: [{ field: "payload", renderer: { format: "json" } }],
          },
          {
            fields: [{ field: "metadata", renderer: { format: "json" } }],
          },
        ],
      },
      description:
        "Read-only detail view of one audit event showing actor, timestamp, aggregate and the raw event payload and metadata; reached from a row of the audit log.",
      listScreenId: AUDIT_LOG_SCREEN_ID,
      access: { roles: access.admin },
    });
    r.nav({
      id: "audit-log",
      label: "audit:nav.auditLog",
      icon: "file",
      screen: "audit:screen:audit-log",
      order: 30,
    });

    return { queries };
  });
}
