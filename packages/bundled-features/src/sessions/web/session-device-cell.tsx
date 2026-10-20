// Column renderer for the parsed `device` of a session row, registered via `sessionsClient()`.

import { type ColumnRendererProps, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { parsedDeviceSchema } from "../user-agent.ts";

export function SessionDeviceCell({ value }: ColumnRendererProps): ReactNode {
  const t = useTranslation();
  const parsed = parsedDeviceSchema.safeParse(value);
  const device = parsed.success ? parsed.data : null;
  if (device === null) return t("sessions.device.unknown");
  const browser =
    device.browser === null
      ? null
      : device.browserMajor === null
        ? device.browser
        : `${device.browser} ${device.browserMajor}`;
  return [browser, device.os].filter((part) => part !== null).join(" · ");
}
