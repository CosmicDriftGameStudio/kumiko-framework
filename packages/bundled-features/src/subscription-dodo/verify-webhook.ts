// Dodo Payments webhook: Standard Webhooks signature verification plus mapping
// of Dodo's event envelope onto the foundation's normalized events.
//
// Verification always runs against the raw body string; re-serialized JSON
// would change whitespace and break the HMAC. The signature check happens
// before any parsing, so no path bypasses it.

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  BillingEventKinds,
  type PaymentEvent,
  parseProviderConsentId,
  type SubscriptionEvent,
  type SubscriptionEventType,
  SubscriptionEventTypes,
  type SubscriptionStatus,
  SubscriptionStatuses,
} from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import { parseJsonOrThrow } from "@cosmicdrift/kumiko-framework/utils";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { DODO_PROVIDER_NAME } from "./constants.ts";
import type { DodoWebhookRuntime } from "./runtime.ts";

export const WEBHOOK_TOLERANCE_SECONDS = 300;

const SECRET_PREFIX = "whsec_";
const SIGNATURE_VERSION = "v1";
const TIMESTAMP_PATTERN = /^\d+$/;

export type StandardWebhookHeaders = Readonly<Record<string, string>>;

function signatureFor(secretKey: Buffer, signedContent: string): Buffer {
  return createHmac("sha256", secretKey).update(signedContent).digest();
}

function matchesAnyV1Signature(header: string, expected: Buffer): boolean {
  return header.split(" ").some((entry) => {
    const [version, encoded] = entry.split(",");
    if (version !== SIGNATURE_VERSION || !encoded) return false;
    const candidate = Buffer.from(encoded, "base64");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}

/** Throws unless the Standard Webhooks signature over `rawBody` is valid and
 *  the timestamp is within the tolerance in both directions. */
export function verifyStandardWebhook(
  rawBody: string,
  headers: StandardWebhookHeaders,
  secret: string,
  nowSeconds: number,
): void {
  const id = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  const signatureHeader = headers["webhook-signature"];
  if (!id || !timestamp || !signatureHeader) {
    throw new Error(
      "subscription-dodo: webhook-id, webhook-timestamp or webhook-signature missing",
    );
  }
  if (!TIMESTAMP_PATTERN.test(timestamp)) {
    throw new Error("subscription-dodo: webhook-timestamp is not a Unix timestamp in seconds");
  }
  if (Math.abs(nowSeconds - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) {
    throw new Error("subscription-dodo: webhook timestamp outside the tolerance window");
  }
  const secretKey = Buffer.from(
    secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret,
    "base64",
  );
  const expected = signatureFor(secretKey, `${id}.${timestamp}.${rawBody}`);
  if (!matchesAnyV1Signature(signatureHeader, expected)) {
    throw new Error("subscription-dodo: webhook signature verify failed");
  }
}

// =============================================================================
// Event mapping
// =============================================================================

const DODO_SUBSCRIPTION_EVENT_TYPES: Readonly<Record<string, SubscriptionEventType>> = {
  "subscription.active": SubscriptionEventTypes.created,
  "subscription.updated": SubscriptionEventTypes.updated,
  "subscription.plan_changed": SubscriptionEventTypes.updated,
  "subscription.paused": SubscriptionEventTypes.updated,
  "subscription.unpaused": SubscriptionEventTypes.updated,
  "subscription.update_payment_method": SubscriptionEventTypes.updated,
  "subscription.renewed": SubscriptionEventTypes.invoicePaid,
  "subscription.past_due": SubscriptionEventTypes.invoicePaymentFailed,
  "subscription.on_hold": SubscriptionEventTypes.invoicePaymentFailed,
  "subscription.cancelled": SubscriptionEventTypes.canceled,
  "subscription.expired": SubscriptionEventTypes.canceled,
  "subscription.failed": SubscriptionEventTypes.canceled,
};

const DODO_SUBSCRIPTION_STATUSES: Readonly<Record<string, SubscriptionStatus>> = {
  pending: SubscriptionStatuses.incomplete,
  active: SubscriptionStatuses.active,
  on_hold: SubscriptionStatuses.pastDue,
  past_due: SubscriptionStatuses.pastDue,
  paused: SubscriptionStatuses.pastDue,
  cancelled: SubscriptionStatuses.canceled,
  failed: SubscriptionStatuses.canceled,
  expired: SubscriptionStatuses.canceled,
};

const PAYMENT_SUCCEEDED = "payment.succeeded";

const metadataSchema = z.record(z.string(), z.unknown()).nullish();
const customerSchema = z.object({ customer_id: z.string().min(1) });

const envelopeSchema = z.object({
  type: z.string(),
  timestamp: z.iso.datetime({ offset: true }),
  data: z.unknown(),
});

export const dodoSubscriptionSchema = z.object({
  subscription_id: z.string().min(1),
  product_id: z.string().min(1),
  status: z.string(),
  customer: customerSchema,
  metadata: metadataSchema,
  next_billing_date: z.iso.datetime({ offset: true }),
  cancel_at_next_billing_date: z.boolean().nullish(),
});
export type DodoSubscription = z.infer<typeof dodoSubscriptionSchema>;

const dodoPaymentSchema = z.object({
  subscription_id: z.string().nullish(),
  checkout_session_id: z.string().nullish(),
  customer: customerSchema,
  metadata: metadataSchema,
  product_cart: z.array(z.object({ product_id: z.string().min(1) })).nullish(),
});

function metadataString(metadata: DodoSubscription["metadata"], key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export type MappedDodoSubscriptionState = {
  readonly status: SubscriptionStatus;
  readonly tier: string;
  readonly currentPeriodEnd: string;
  readonly cancelAt: string | null;
};

/** Shared by the webhook and retrieveSubscription so both map Dodo state
 *  identically. Null when the status is unknown or the product is not in
 *  `priceToTier` (SubscriptionEvent.tier is required). */
export function mapDodoSubscriptionState(
  sub: DodoSubscription,
  priceToTier: Readonly<Record<string, string>>,
): MappedDodoSubscriptionState | null {
  const status = DODO_SUBSCRIPTION_STATUSES[sub.status];
  const tier = priceToTier[sub.product_id];
  if (!status || !tier) return null;
  return {
    status,
    tier,
    currentPeriodEnd: sub.next_billing_date,
    cancelAt: sub.cancel_at_next_billing_date === true ? sub.next_billing_date : null,
  };
}

export type DodoWebhookOptions = {
  readonly priceToTier: Readonly<Record<string, string>>;
  /** Test seam: Unix seconds. Defaults to the wall clock. */
  readonly nowSeconds?: () => number;
};

function currentUnixSeconds(): number {
  return Math.floor(Temporal.Now.instant().epochMilliseconds / 1000);
}

function parsePaymentEvent(providerEventId: string, data: unknown): PaymentEvent | null {
  const parsed = dodoPaymentSchema.safeParse(data);
  if (!parsed.success) return null;
  const payment = parsed.data;
  // A subscription's own payments are covered by its subscription.* events.
  if (payment.subscription_id) return null;
  const tenantId = metadataString(payment.metadata, "tenantId");
  const priceId = payment.product_cart?.[0]?.product_id;
  if (!tenantId || !priceId) return null;
  const consentId = parseProviderConsentId(payment.metadata?.["consentId"]);
  return {
    kind: BillingEventKinds.payment,
    providerEventId,
    providerName: DODO_PROVIDER_NAME,
    tenantId,
    ...(consentId !== undefined && { consentId }),
    ...(payment.checkout_session_id && { providerCheckoutId: payment.checkout_session_id }),
    providerCustomerId: payment.customer.customer_id,
    priceId,
  };
}

function parseSubscriptionEvent(
  providerEventId: string,
  type: SubscriptionEventType,
  providerEventAt: string,
  data: unknown,
  priceToTier: Readonly<Record<string, string>>,
): SubscriptionEvent | null {
  const parsed = dodoSubscriptionSchema.safeParse(data);
  if (!parsed.success) return null;
  const sub = parsed.data;
  const tenantId = metadataString(sub.metadata, "tenantId");
  const state = mapDodoSubscriptionState(sub, priceToTier);
  if (!tenantId || !state) return null;
  const consentId = parseProviderConsentId(sub.metadata?.["consentId"]);
  return {
    providerEventId,
    providerName: DODO_PROVIDER_NAME,
    type,
    tenantId,
    ...(consentId !== undefined && { consentId }),
    providerCustomerId: sub.customer.customer_id,
    providerSubscriptionId: sub.subscription_id,
    providerEventAt,
    ...state,
  };
}

export function verifyAndParseDodoWebhook(
  runtime: DodoWebhookRuntime,
  options: DodoWebhookOptions,
): (
  rawBody: string,
  headers: Record<string, string>,
  systemSecrets?: SecretsContext,
) => Promise<SubscriptionEvent | PaymentEvent | null> {
  const nowSeconds = options.nowSeconds ?? currentUnixSeconds;
  return async (rawBody, headers, systemSecrets) => {
    const secret = await runtime.resolveWebhookSecret(systemSecrets);
    verifyStandardWebhook(rawBody, headers, secret, nowSeconds());

    // Past verification the body is trusted to be Dodo's; a malformed shape is
    // schema drift, so it is dropped (200 ignored) instead of answered with a 401.
    const envelope = envelopeSchema.safeParse(
      parseJsonOrThrow<unknown>(rawBody, "subscription-dodo webhook body"),
    );
    // verifyStandardWebhook has checked webhook-id is present.
    const providerEventId = headers["webhook-id"];
    if (!envelope.success || !providerEventId) return null;

    const { type, timestamp, data } = envelope.data;
    if (type === PAYMENT_SUCCEEDED) return parsePaymentEvent(providerEventId, data);
    const normalizedType = DODO_SUBSCRIPTION_EVENT_TYPES[type];
    if (!normalizedType) return null;
    return parseSubscriptionEvent(
      providerEventId,
      normalizedType,
      timestamp,
      data,
      options.priceToTier,
    );
  };
}
