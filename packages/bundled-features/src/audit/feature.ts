import {
  access,
  defineFeature,
  type FeatureDefinition,
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
        { field: "createdAt", label: "audit.log.col.when", renderer: { format: "timestamp" } },
        { field: "type", label: "audit.log.col.type" },
        { field: "createdBy", label: "audit.log.col.actor" },
      ],
      searchable: true,
      defaultSort: { field: "createdAt", dir: "desc" },
      rowActions: [
        {
          kind: "navigate",
          id: "details",
          label: "audit.log.details",
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
        type: "audit.log.col.type",
        createdAt: "audit.log.col.when",
        aggregateType: "audit.log.col.aggregate",
        aggregateId: "audit.log.col.aggregate",
        createdBy: "audit.log.col.actor",
        id: "audit.log.detail.field.id",
        payload: "audit.log.detail.payload",
        metadata: "audit.log.detail.metadata",
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
          {
            title: "audit.log.detail.payload",
            fields: [{ field: "payload", renderer: { format: "json" } }],
          },
          {
            title: "audit.log.detail.metadata",
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
