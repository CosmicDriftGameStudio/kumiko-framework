import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import { scrubEventHeaderKeys } from "@cosmicdrift/kumiko-framework/migrations";
import {
  INVOICE_PAID_EVENT_QN,
  INVOICE_PAYMENT_FAILED_EVENT_QN,
  SUBSCRIPTION_CANCELED_EVENT_QN,
  SUBSCRIPTION_CREATED_EVENT_QN,
  SUBSCRIPTION_UPDATED_EVENT_QN,
} from "./events.ts";

export const SCRUB_RAW_PAYLOAD_HEADERS_ESCAPE_HATCH_REASON =
  "removes the legacy rawPayload header from billing events of every tenant";

const RAW_PAYLOAD_HEADER = "rawPayload";

const SCRUB_REASON =
  "billing events written before the provider payload was dropped carry it as a plaintext header, which crypto-shredding cannot reach";

// Safe to repeat: only events that still carry the header are touched.
export async function scrubLegacyRawPayloadHeaders(db: DbRunner): Promise<number> {
  const { removedKeys } = await scrubEventHeaderKeys(db, {
    eventTypes: [
      SUBSCRIPTION_CREATED_EVENT_QN,
      SUBSCRIPTION_UPDATED_EVENT_QN,
      SUBSCRIPTION_CANCELED_EVENT_QN,
      INVOICE_PAID_EVENT_QN,
      INVOICE_PAYMENT_FAILED_EVENT_QN,
    ],
    keys: [RAW_PAYLOAD_HEADER],
    reason: SCRUB_REASON,
  });
  return removedKeys;
}
