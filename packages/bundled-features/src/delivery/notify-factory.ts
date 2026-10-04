import type { NotifyFactory } from "@cosmicdrift/kumiko-framework/engine";
import type { DeliveryService } from "./types.js";

// The same binding runProdApp wires into the app context: the calling context's
// job dispatcher is handed to notify() per call, so queued channels go through
// the delivery jobs. deliverQueuedInline drops the dispatcher and sends inline.
export function createDeliveryNotifyFactory(
  deliveryService: DeliveryService,
  options: { readonly deliverQueuedInline?: boolean } = {},
): NotifyFactory {
  return (user, tenantId, jobDispatcher) => (notificationType, notifyOptions) =>
    deliveryService.notify(
      notificationType,
      notifyOptions,
      user,
      tenantId,
      options.deliverQueuedInline === true ? undefined : jobDispatcher,
    );
}
