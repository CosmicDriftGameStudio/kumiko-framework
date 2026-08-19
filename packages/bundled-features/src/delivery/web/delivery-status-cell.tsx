// @runtime client
// Column-renderer for the delivery-log screen's status column, registered
// via `deliveryClient()`'s `columnRenderers` map (screen.columns[].renderer
// in feature.ts). The list frame itself is the generic declarative
// projectionList renderer — only this one cell stays TSX.

import type { ColumnRendererProps } from "@cosmicdrift/kumiko-renderer";
import { StatusBadge, type StatusTone } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";
import { DeliveryStatus } from "../public-names";

const STATUS_TONE: Readonly<Record<string, StatusTone>> = {
  [DeliveryStatus.sent]: "ok",
  [DeliveryStatus.failed]: "bad",
  [DeliveryStatus.queued]: "muted",
  [DeliveryStatus.skipped]: "muted",
};

export function DeliveryStatusCell({ row }: ColumnRendererProps): ReactNode {
  const status = typeof row["status"] === "string" ? row["status"] : "";
  return (
    <StatusBadge tone={STATUS_TONE[status] ?? "muted"} testId="delivery-status-cell">
      {status}
    </StatusBadge>
  );
}
