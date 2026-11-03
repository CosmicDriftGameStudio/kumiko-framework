import type { DeliveryAttemptLogFactory } from "@cosmicdrift/kumiko-framework/engine";
import type { DeliveryService } from "./types.ts";

// Tenant and recipient come from the binding, never from the entry, so a handler cannot log an
// attempt for another tenant or another recipient.
export function createDeliveryAttemptLogFactory(
  deliveryService: Pick<DeliveryService, "logAttempt">,
): DeliveryAttemptLogFactory {
  return (user, tenantId, deliveryDb) => (entry) =>
    deliveryService.logAttempt({ ...entry, tenantId, recipientId: user.id }, deliveryDb);
}
