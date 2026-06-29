import type { NotifyPriority } from "@cosmicdrift/kumiko-framework/engine";
import { QnTypes, qn } from "@cosmicdrift/kumiko-framework/engine";

// Feature name
export const DELIVERY_FEATURE = "delivery" as const;

// notify() priority → BullMQ job priority. Lower number = processed first; all
// > 0 so prioritised delivery jobs never mix with BullMQ's "0 = unprioritised
// FIFO" bucket. critical jobs jump ahead of normal/low in the worker queue.
export const deliveryPriorityRank: Record<NotifyPriority, number> = {
  critical: 1,
  normal: 2,
  low: 3,
};

// Qualified write handler names (QN format: scope:type:name)
export const DeliveryHandlers = {
  setPreference: "delivery:write:set-preference",
} as const;

// Qualified query handler names (QN format: scope:type:name)
export const DeliveryQueries = {
  log: "delivery:query:log",
  preferences: "delivery:query:preferences",
} as const;

// Error codes
export const DeliveryErrors = {
  noRecipient: "delivery_no_recipient",
  channelFailed: "delivery_channel_failed",
} as const;

// Delivery status values. `queued` is the initial state of an async attempt
// (email/push) between dispatch and the worker running — it transitions to
// sent/failed once the delivery.send job finishes. Synchronous attempts
// (inApp, skips) never observe `queued`.
export const DeliveryStatus = {
  queued: "queued",
  sent: "sent",
  failed: "failed",
  skipped: "skipped",
} as const;

export type DeliveryStatusValue = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

// Qualified domain-event name. Emitted by the delivery-service on every
// attempt (sent / failed / skipped). A multi-stream-projection materialises
// each event into a row in deliveryAttemptsTable for the log-query handler.
export const DELIVERY_ATTEMPT_EVENT = "delivery:event:attempt" as const;

// Background jobs that carry async (queued-mode) channels. render decouples the
// expensive template step from the send so each retries independently; render
// dispatches send on success. Channels without a render() (push) skip straight
// to send.
//
// Short names are what r.job() registers; the registry qualifies them to
// `scope:job:name`. Dispatch (notify + render→send chaining) must use the
// QUALIFIED name, so DeliveryJobs holds the qualified form via qn().
export const DeliveryJobNames = {
  render: "render",
  send: "send",
} as const;

export const DeliveryJobs = {
  render: qn(DELIVERY_FEATURE, QnTypes.job, DeliveryJobNames.render),
  send: qn(DELIVERY_FEATURE, QnTypes.job, DeliveryJobNames.send),
} as const;
