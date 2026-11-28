import type { Client } from "mollie-api-typescript";
import type { MollieClientShape } from "./verify-webhook.ts";

/** Binds the plugin's minimal fetch shape to the real SDK client. Kept apart
 *  so a test can run it against a stub HTTP server (SDK responses are
 *  zod-validated, so a wrong unwrap only shows at runtime). */
export function mollieClientShapeOf(client: Client): MollieClientShape {
  return {
    payments: { get: (id) => client.payments.get({ paymentId: id }) },
    customerSubscriptions: {
      get: (subId, customerId) => client.subscriptions.get({ customerId, subscriptionId: subId }),
      list: async (customerId) => {
        const firstPage = await client.subscriptions.list({ customerId });
        return firstPage.result.embedded.subscriptions ?? [];
      },
      create: (customerId, params) =>
        client.subscriptions.create({ customerId, subscriptionRequest: params }),
    },
  };
}
