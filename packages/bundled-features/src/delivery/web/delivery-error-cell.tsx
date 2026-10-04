// @runtime client
// Error column. The log only carries fixed codes (`DeliveryErrorCode`); `http_<status>`
// takes the status as a parameter, anything unknown shows as the raw value.

import { type ColumnRendererProps, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { translateOrRaw } from "../../shared/web/translate-or-raw.js";

const HTTP_ERROR_PATTERN = /^http_(\d{3})$/;

export function DeliveryErrorCell({ row }: ColumnRendererProps): ReactNode {
  const t = useTranslation();
  const error = row["error"];
  if (typeof error !== "string" || error === "") return null;
  const http = HTTP_ERROR_PATTERN.exec(error);
  if (http) return t("delivery.error.http", { status: http[1] });
  return translateOrRaw(t, `delivery.error.${error}`, error);
}
