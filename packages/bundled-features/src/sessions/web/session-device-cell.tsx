// Column renderer for session devices, registered via `sessionsClient()`. Takes the server-made
// `deviceLabel` string, or the parsed `device` object for screens that bind that column.

import { type ColumnRendererProps, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { formatDeviceLabel, parsedDeviceSchema } from "./user-agent.ts";

function deviceLabelOf(value: unknown): string | null {
  if (typeof value === "string") return value === "" ? null : value;
  const parsed = parsedDeviceSchema.safeParse(value);
  return parsed.success ? formatDeviceLabel(parsed.data) : null;
}

export function SessionDeviceCell({ value }: ColumnRendererProps): ReactNode {
  const t = useTranslation();
  return deviceLabelOf(value) ?? t("sessions.device.unknown");
}
