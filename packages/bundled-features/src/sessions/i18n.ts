import { handlerFieldLabelKey, handlerTitleKey } from "@cosmicdrift/kumiko-framework/engine";
import { SessionHandlers as H } from "./constants.ts";

export const SESSIONS_HANDLER_I18N: Readonly<Record<string, { readonly en: string }>> = {
  [handlerTitleKey(H.revoke)]: { en: "Sign out session" },
  [handlerFieldLabelKey(H.revoke, "id")]: { en: "Session" },
  [handlerTitleKey(H.revokeAllForUser)]: { en: "Sign out user everywhere" },
  [handlerFieldLabelKey(H.revokeAllForUser, "userId")]: { en: "User" },
  [handlerFieldLabelKey(H.revokeAllForUser, "tenantId")]: { en: "Tenant" },
  [handlerFieldLabelKey(H.revokeAllForUser, "exceptSessionId")]: { en: "Session to keep" },
  [handlerTitleKey(H.revokeAllOthers)]: { en: "Sign out other devices" },
};
