import {
  access,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { AUDIT_LOG_DETAIL_SCREEN_ID, AUDIT_LOG_SCREEN_ID } from "./constants";
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

    const queries = {
      list: r.queryHandler(listQuery),
      details: r.queryHandler(detailsQuery),
    };

    r.screen({
      id: AUDIT_LOG_SCREEN_ID,
      type: "custom",
      renderer: { react: { __component: "AuditLogScreen" } },
      access: { roles: access.admin },
    });
    r.screen({
      id: AUDIT_LOG_DETAIL_SCREEN_ID,
      type: "custom",
      renderer: { react: { __component: "AuditLogDetailScreen" } },
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
