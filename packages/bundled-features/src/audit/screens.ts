// Columns, labels and layout shared by the tenant audit log and its all-tenants variant, so the
// two screen pairs cannot drift apart. The all-tenants variant only adds the tenant.

import { i18nKey } from "@cosmicdrift/kumiko-framework/engine";
import type { EditLayout, ListColumnSpec } from "@cosmicdrift/kumiko-framework/ui-types";

const TENANT_REFERENCE = { refEntity: "tenant:tenant", refLabelField: "name" } as const;
const ACTOR_REFERENCE = { refEntity: "user:user", refLabelField: "displayName" } as const;

const WHEN_COLUMN = {
  field: "createdAt",
  label: i18nKey("audit.log.col.when"),
  renderer: { format: "timestamp" },
} as const satisfies ListColumnSpec;
const TENANT_COLUMN = {
  field: "tenantId",
  label: i18nKey("audit.log.col.tenant"),
  ...TENANT_REFERENCE,
} as const satisfies ListColumnSpec;
const TYPE_COLUMN = { field: "type", label: i18nKey("audit.log.col.type") } as const;
const ACTOR_COLUMN = {
  field: "createdBy",
  label: i18nKey("audit.log.col.actor"),
  ...ACTOR_REFERENCE,
} as const satisfies ListColumnSpec;

export const AUDIT_LOG_COLUMNS = [WHEN_COLUMN, TYPE_COLUMN, ACTOR_COLUMN] as const;
export const AUDIT_LOG_ALL_TENANTS_COLUMNS = [
  WHEN_COLUMN,
  TENANT_COLUMN,
  TYPE_COLUMN,
  ACTOR_COLUMN,
] as const;

export const AUDIT_LOG_DATE_RANGE_FACET = {
  type: "dateRange",
  field: "createdAt",
  label: i18nKey("audit.log.col.when"),
  params: { from: "from", to: "to" },
} as const;

export const AUDIT_LOG_TENANT_FACET = {
  type: "reference",
  field: "tenantId",
  label: i18nKey("audit.log.col.tenant"),
  entity: TENANT_REFERENCE.refEntity,
  labelField: TENANT_REFERENCE.refLabelField,
} as const;

export const AUDIT_LOG_DETAIL_FIELD_LABELS = {
  type: i18nKey("audit.log.col.type"),
  createdAt: i18nKey("audit.log.col.when"),
  aggregateType: i18nKey("audit.log.col.aggregateType"),
  aggregateId: i18nKey("audit.log.col.aggregateId"),
  createdBy: i18nKey("audit.log.col.actor"),
  id: i18nKey("audit.log.detail.field.id"),
  payload: i18nKey("audit.log.detail.payload"),
  metadata: i18nKey("audit.log.detail.metadata"),
} as const;

export function auditLogDetailLayout(options: { readonly withTenant: boolean }): EditLayout {
  return {
    sections: [
      {
        fields: [
          "type",
          { field: "createdAt", renderer: { format: "timestamp" } },
          ...(options.withTenant ? [{ field: "tenantId", ...TENANT_REFERENCE }] : []),
          "aggregateType",
          "aggregateId",
          { field: "createdBy", ...ACTOR_REFERENCE },
          "id",
        ],
      },
      // No section `title` here (fw#2312 label-dedup fix): each section
      // holds exactly one field, so a title would repeat the field's own
      // label (rendered by RenderField as the Field's heading) verbatim.
      { fields: [{ field: "payload", renderer: { format: "json" } }] },
      { fields: [{ field: "metadata", renderer: { format: "json" } }] },
    ],
  };
}
