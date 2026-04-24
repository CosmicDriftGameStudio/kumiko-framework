// Event-payload schema for the deliveryAttempt aggregate. Shared between
// delivery-feature.ts (registers it via r.defineEvent) and
// delivery-service.ts (validates payloads before the low-level append()
// — out-of-dispatcher writes otherwise skip schema enforcement).

import { z } from "zod";
import { DeliveryStatus } from "./constants";

export const deliveryAttemptSchema = z.object({
  notificationType: z.string(),
  channel: z.string(),
  recipientId: z.string().nullable(),
  recipientAddress: z.string().nullable(),
  status: z.enum([DeliveryStatus.sent, DeliveryStatus.failed, DeliveryStatus.skipped]),
  error: z.string().nullable(),
});

export type DeliveryAttemptPayload = z.infer<typeof deliveryAttemptSchema>;
