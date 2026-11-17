import { handlerTitleKey } from "@cosmicdrift/kumiko-framework/engine";
import { TenantLifecycleHandlers as H } from "./constants.ts";

export const TENANT_LIFECYCLE_I18N: Readonly<Record<string, { readonly en: string }>> = {
  [handlerTitleKey(H.cancelDestruction)]: { en: "Cancel account closure" },
  [handlerTitleKey(H.requestDestruction)]: { en: "Close account" },
};
