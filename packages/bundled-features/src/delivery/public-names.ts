// @runtime client
// String-only delivery QNs and screen ids — safe for client bundles.

export const DELIVERY_FEATURE = "delivery" as const;

export const DeliveryHandlers = {
  setPreference: "delivery:write:set-preference",
  unsubscribeAddress: "delivery:write:unsubscribe-address",
  unsubscribeUser: "delivery:write:unsubscribe-user",
  resubscribeAddress: "delivery:write:resubscribe-address",
  resubscribeUser: "delivery:write:resubscribe-user",
} as const;

// Fixed so links mailed out today keep working — the unsubscribe route is
// mounted at this exact path via `extraRoutes: [...createUnsubscribeRoutes(...)]`.
export const DELIVERY_UNSUBSCRIBE_PATH = "/api/delivery/unsubscribe" as const;

// Mounted alongside the unsubscribe route by the same
// `createUnsubscribeRoutes(...)` call — same token, same verify() path, the
// undo direction. Token is taken from the JSON/form body only, never the
// query, so a mail-client link prefetcher can't accidentally resubscribe
// someone.
export const DELIVERY_RESUBSCRIBE_PATH = "/api/delivery/resubscribe" as const;

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
  // removeAddressOptOut refuses to delete the opt-out row at the last
  // available id generation, so an address can always still unsubscribe
  // (see MAX_ADDRESS_OPT_OUT_GENERATIONS in address-opt-out.ts).
  resubscribeLimitReached: "resubscribe_limit_reached",
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
