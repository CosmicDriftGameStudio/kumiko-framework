// Event-payload schema for the deliveryAttempt aggregate. Shared between
// delivery-feature.ts (registers it via r.defineEvent) and
// delivery-service.ts (validates payloads before the low-level append()
// — out-of-dispatcher writes otherwise skip schema enforcement).

import {
  DELIVERY_FAILURE_CODES,
  DELIVERY_SKIP_REASONS,
  HTTP_ERROR_CODE_PATTERN,
} from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { DeliveryStatus } from "./constants.js";

export const deliveryAttemptSchema = z.object({
  notificationType: z.string(),
  channel: z.string(),
  recipientId: z.string().nullable(),
  recipientAddress: z.string().nullable(),
  status: z.enum([
    DeliveryStatus.queued,
    DeliveryStatus.sent,
    DeliveryStatus.failed,
    DeliveryStatus.skipped,
  ]),
  // Closed code set; z.custom would not serialize to JSON-Schema. Events written
  // before the code vocabulary may hold free text, they are not re-validated on replay.
  error: z
    .union([
      z.enum([...DELIVERY_FAILURE_CODES, ...DELIVERY_SKIP_REASONS]),
      z.string().regex(HTTP_ERROR_CODE_PATTERN),
    ])
    .nullable(),
  priority: z.enum(["critical", "normal", "low"]),
});

export type DeliveryAttemptPayload = z.infer<typeof deliveryAttemptSchema>;
