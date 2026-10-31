import { type ColumnRendererProps, formatWhen, useLocale } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";

export function DeliveryTimeCell({ row }: ColumnRendererProps): ReactNode {
  const locale = useLocale().locale();
  const createdAt = row["createdAt"];
  return typeof createdAt === "string" ? formatWhen(createdAt, locale) : "";
}
