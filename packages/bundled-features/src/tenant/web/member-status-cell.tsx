// @runtime client
// Column-renderer for the /members screen's status column, registered via
// `tenantClient()`'s `columnRenderers` map (screen.columns[].renderer in
// screens.ts). The list frame itself is the generic declarative
// projectionList renderer — only this one cell stays TSX.

import { type ColumnRendererProps, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { StatusBadge, type StatusTone } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";
import { translateOrRaw } from "./translate-or-raw";

const STATUS_TONE: Readonly<Record<string, StatusTone>> = {
  active: "ok",
  pending: "muted",
};

export function MemberStatusCell({ row }: ColumnRendererProps): ReactNode {
  const t = useTranslation();
  const status = typeof row["status"] === "string" ? row["status"] : "";
  const label =
    status === "" ? "" : translateOrRaw(t, `tenant.members.filter.status.option.${status}`, status);
  return (
    <StatusBadge tone={STATUS_TONE[status] ?? "muted"} testId="member-status-cell">
      {label}
    </StatusBadge>
  );
}
