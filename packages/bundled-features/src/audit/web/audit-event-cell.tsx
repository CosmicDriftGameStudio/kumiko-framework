// Column renderers of the audit log, registered via `auditClient()`'s `columnRenderers`
// (screens.ts references them by name). The list frame stays the generic projectionList.

import { type ColumnRendererProps, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { auditEntityLabel, isAuditEventAction } from "./audit-event-labels.ts";

export function AuditEventCell({ value, row }: ColumnRendererProps): ReactNode {
  const t = useTranslation();
  const rawType = typeof value === "string" ? value : "";
  const labelKey = row["eventLabelKey"];
  if (typeof labelKey === "string") return t(labelKey);
  const action = row["eventAction"];
  const entity = auditEntityLabel(t, row);
  if (!isAuditEventAction(action) || entity === null) return rawType;
  return t("audit.log.event", { entity, action: t(`audit.log.action.${action}`) });
}

export function AuditObjectCell({ row }: ColumnRendererProps): ReactNode {
  const t = useTranslation();
  return auditEntityLabel(t, row) ?? "";
}
