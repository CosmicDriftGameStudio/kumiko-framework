// @runtime client
// Notification type column. Types are QNs like `<scope>:notify:<name>`; the
// translation key is `<scope>.notification.<name>`, registered by the app that
// owns the notification (bundled features register none). Falls back to the short
// name, or to the raw value for any other format.

import { type ColumnRendererProps, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { translateOrRaw } from "../../shared/web/translate-or-raw.js";

const NOTIFICATION_QN_PATTERN = /^([^:]+):notify:(.+)$/;

export function DeliveryTypeCell({ row }: ColumnRendererProps): ReactNode {
  const t = useTranslation();
  const type = typeof row["type"] === "string" ? row["type"] : "";
  const match = NOTIFICATION_QN_PATTERN.exec(type);
  if (!match) return type;
  const [, scope, name] = match;
  return translateOrRaw(t, `${scope}.notification.${name}`, name ?? type);
}
