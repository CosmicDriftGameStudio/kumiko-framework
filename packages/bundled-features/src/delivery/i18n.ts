import {
  DELIVERY_FAILURE_CODES,
  DELIVERY_SKIP_REASONS,
  type DeliveryFailureCode,
  type DeliverySkipReason,
} from "@cosmicdrift/kumiko-framework/engine";
import { DeliveryStatus, type DeliveryStatusValue } from "./public-names.js";

type LocalizedString = { readonly en: string };

// Typed over the code vocabularies, so a new code without a label fails to compile.
const ERROR_LABELS = {
  timeout: "Timed out",
  network_error: "Network error",
  redirect_blocked: "Redirect blocked",
  host_not_allowed: "Host not allowed",
  missing_credentials: "Missing credentials",
  invalid_address: "Invalid address",
  unexpected_response: "Unexpected provider response",
  render_failed: "Rendering failed",
  send_failed: "Sending failed",
  channel_error: "Channel error",
  channel_disabled: "Channel disabled",
  preference_disabled: "Disabled in preferences",
  rate_limited: "Rate limited",
  no_address: "No address",
  unsubscribed: "Unsubscribed",
  duplicate_idempotency_key: "Duplicate request",
} as const satisfies Record<DeliveryFailureCode | DeliverySkipReason, string>;

const STATUS_LABELS = {
  queued: "Queued",
  sent: "Sent",
  failed: "Failed",
  skipped: "Skipped",
} as const satisfies Record<DeliveryStatusValue, string>;

function labelKeys(
  prefix: string,
  codes: readonly string[],
  labels: Readonly<Record<string, string>>,
): Record<string, LocalizedString> {
  return Object.fromEntries(
    codes.map((code) => [`${prefix}.${code}`, { en: labels[code] ?? code }]),
  );
}

export const DELIVERY_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:delivery-log.title": { en: "Delivery log" },
  "delivery:nav.deliveryLog": { en: "Delivery" },
  "delivery.log.col.createdAt": { en: "Time" },
  "delivery.log.col.tenantId": { en: "Tenant" },
  "delivery.log.col.type": { en: "Type" },
  "delivery.log.col.channel": { en: "Channel" },
  "delivery.log.col.recipient": { en: "Recipient" },
  "delivery.log.col.status": { en: "Status" },
  "delivery.log.col.error": { en: "Error" },
  ...labelKeys("delivery.status", Object.values(DeliveryStatus), STATUS_LABELS),
  ...labelKeys(
    "delivery.error",
    [...DELIVERY_FAILURE_CODES, ...DELIVERY_SKIP_REASONS],
    ERROR_LABELS,
  ),
  "delivery.status.sentUnconfirmed": { en: "Sent (unconfirmed)" },
  "delivery.error.http": { en: "HTTP {status}" },
};
