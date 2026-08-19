// @runtime client
// String-only delivery QNs and screen ids — safe for client bundles.

export const DELIVERY_FEATURE = "delivery" as const;

export const DeliveryHandlers = {
  setPreference: "delivery:write:set-preference",
} as const;

export const DeliveryQueries = {
  log: "delivery:query:log",
  preferences: "delivery:query:preferences",
} as const;

export const DELIVERY_LOG_SCREEN_ID = "delivery-log" as const;

// Client column-renderer registered for the delivery-log screen's status
// column — see `screen.columns[].renderer.react.__component` in feature.ts
// and `deliveryClient()`'s `columnRenderers` map.
export const DELIVERY_STATUS_CELL_COMPONENT = "DeliveryStatusCell" as const;

export const DeliveryErrors = {
  noRecipient: "delivery_no_recipient",
  channelFailed: "delivery_channel_failed",
} as const;

export const DeliveryStatus = {
  queued: "queued",
  sent: "sent",
  failed: "failed",
  skipped: "skipped",
} as const;

export type DeliveryStatusValue = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

export const DELIVERY_ATTEMPT_EVENT = "delivery:event:attempt" as const;

export const DeliveryJobNames = {
  render: "render",
  send: "send",
} as const;
