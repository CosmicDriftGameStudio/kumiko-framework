// @runtime client
// Channel column: the label comes from `delivery.channel.<name>`, registered by each
// channel feature; unknown channels show their raw name.

import { type ColumnRendererProps, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { translateOrRaw } from "../../shared/web/translate-or-raw.js";

export function DeliveryChannelCell({ row }: ColumnRendererProps): ReactNode {
  const t = useTranslation();
  const channel = typeof row["channel"] === "string" ? row["channel"] : "";
  return translateOrRaw(t, `delivery.channel.${channel}`, channel);
}
