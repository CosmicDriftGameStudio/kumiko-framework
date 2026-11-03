import type { DbConnection } from "./db-connection.ts";
import type { NotifyPriority, SessionUser } from "./handlers.ts";
import type { TenantId } from "./identifiers.ts";

export type NotifyDeliveryStatus = "queued" | "sent" | "failed" | "skipped";

// Closed vocabulary for delivery failures and skips. Only these values (plus
// `http_<status>`) are ever stored or returned as a delivery error, never a raw
// error message: provider errors can carry URLs, tokens and addresses.
export const DELIVERY_FAILURE_CODES = [
  "timeout",
  "network_error",
  "redirect_blocked",
  "host_not_allowed",
  "missing_credentials",
  "invalid_address",
  "unexpected_response",
  "render_failed",
  "send_failed",
  "channel_error",
] as const;

export const DELIVERY_SKIP_REASONS = [
  "channel_disabled",
  "preference_disabled",
  "rate_limited",
  "no_address",
  "unsubscribed",
  "duplicate_idempotency_key",
] as const;

export type DeliveryFailureCode = (typeof DELIVERY_FAILURE_CODES)[number];
export type DeliverySkipReason = (typeof DELIVERY_SKIP_REASONS)[number];
export type DeliveryErrorCode = DeliveryFailureCode | DeliverySkipReason | `http_${number}`;

// Failures a chat webhook send can end in: http_<status> plus the transport codes.
export type ChatSendFailureCode =
  | `http_${number}`
  | Exclude<DeliveryFailureCode, "render_failed" | "send_failed" | "channel_error">;

export const HTTP_ERROR_CODE_PATTERN = /^http_(\d{3})$/;

export function isDeliveryErrorCode(value: unknown): value is DeliveryErrorCode {
  if (typeof value !== "string") return false;
  return (
    HTTP_ERROR_CODE_PATTERN.test(value) ||
    DELIVERY_FAILURE_CODES.some((code) => code === value) ||
    DELIVERY_SKIP_REASONS.some((reason) => reason === value)
  );
}

// A delivery the handler made itself (channel.send outside ctx.notify), logged for the bound user.
export type DeliveryAttemptLogEntry = {
  readonly notificationType: string;
  readonly channel: string;
  readonly recipientAddress: string | null;
  readonly status: NotifyDeliveryStatus;
  readonly error: DeliveryErrorCode | null;
  readonly priority: NotifyPriority;
};

export type DeliveryAttemptLogFn = (entry: DeliveryAttemptLogEntry) => Promise<void>;

// Delivery writes on deliveryDb, never through the handler's TenantDb, so the attempt survives a
// rolled-back handler transaction and needs no escapeHatch; tenant and recipient are pinned here.
// Concrete implementation in bundled-features/delivery (cross-package boundary)
export type DeliveryAttemptLogFactory = (
  user: SessionUser,
  tenantId: TenantId,
  deliveryDb?: DbConnection,
) => DeliveryAttemptLogFn;
