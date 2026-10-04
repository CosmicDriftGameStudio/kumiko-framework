// @runtime client
import { type ColumnRendererProps, formatWhen } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";

export function DeliveryTimeCell({ row }: ColumnRendererProps): ReactNode {
  const createdAt = row["createdAt"];
  return typeof createdAt === "string" ? formatWhen(createdAt) : "";
}
