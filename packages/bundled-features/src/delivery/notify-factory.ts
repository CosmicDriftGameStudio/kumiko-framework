import type { NotifyFactory, NotifyFn, NotifyOptions } from "@cosmicdrift/kumiko-framework/engine";
import type { DeliveryService } from "./types.ts";

// The same binding runProdApp wires into the app context: the calling context's
// job dispatcher is handed to notify() per call, so queued channels go through
// the delivery jobs.
export function createDeliveryNotifyFactory(
  deliveryService: Pick<DeliveryService, "notify">,
): NotifyFactory {
  return (user, tenantId, jobDispatcher, deliveryDb, fileProviderResolver) => {
    const notify: NotifyFn = (notificationType: string, notifyOptions: NotifyOptions) =>
      deliveryService.notify(
        notificationType,
        notifyOptions,
        user,
        tenantId,
        jobDispatcher,
        deliveryDb,
        fileProviderResolver,
      );
    return notify;
  };
}
