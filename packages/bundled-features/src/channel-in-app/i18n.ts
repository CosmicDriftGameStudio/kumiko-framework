import { handlerFieldLabelKey, handlerTitleKey } from "@cosmicdrift/kumiko-framework/engine";
import { InAppHandlers as H } from "./constants.ts";

export const CHANNEL_IN_APP_I18N: Readonly<Record<string, { readonly en: string }>> = {
  "delivery.channel.inApp": { en: "In-app" },
  [handlerTitleKey(H.markAllRead)]: { en: "Mark all as read" },
  [handlerTitleKey(H.markRead)]: { en: "Mark as read" },
  [handlerFieldLabelKey(H.markRead, "id")]: { en: "Message" },
};
