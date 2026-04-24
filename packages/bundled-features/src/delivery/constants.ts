// Feature name
export const DELIVERY_FEATURE = "delivery" as const;

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

// Delivery status values
export const DeliveryStatus = {
  sent: "sent",
  failed: "failed",
  skipped: "skipped",
} as const;

export type DeliveryStatusValue = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

// Qualified domain-event name. Emitted by the delivery-service on every
// attempt (sent / failed / skipped). A multi-stream-projection materialises
// each event into a row in deliveryAttemptsTable for the log-query handler.
export const DELIVERY_ATTEMPT_EVENT = "delivery:event:attempt" as const;
