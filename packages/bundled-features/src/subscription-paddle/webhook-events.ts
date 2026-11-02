// Paddle webhook: signature check, then mapping of Paddle's event envelope onto
// the foundation's normalized events. `custom_data.tenantId` only locates the
// tenant's stream; Paddle.js can open checkouts with any customData, so
// billing-foundation accepts an event only for a checkout in its own ledger.

import {
  BillingEventKinds,
  type PaymentEvent,
  type SubscriptionEvent,
  type SubscriptionEventType,
  SubscriptionEventTypes,
} from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import { parseJsonOrThrow } from "@cosmicdrift/kumiko-framework/utils";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import * as z from "zod";
import { PADDLE_PROVIDER_NAME } from "./constants.ts";
import type { PaddleWebhookRuntime } from "./runtime.ts";
import {
  mapPaddleSubscriptionState,
  paddleCustomDataSchema,
  paddleSubscriptionSchema,
} from "./subscription-state.ts";
import { verifyPaddleSignature } from "./verify-webhook.ts";

const PADDLE_SUBSCRIPTION_EVENT_TYPES: Readonly<Record<string, SubscriptionEventType>> = {
  "subscription.created": SubscriptionEventTypes.created,
  "subscription.activated": SubscriptionEventTypes.updated,
  "subscription.updated": SubscriptionEventTypes.updated,
  "subscription.trialing": SubscriptionEventTypes.updated,
  "subscription.paused": SubscriptionEventTypes.updated,
  "subscription.resumed": SubscriptionEventTypes.updated,
  "subscription.past_due": SubscriptionEventTypes.invoicePaymentFailed,
  "subscription.canceled": SubscriptionEventTypes.canceled,
};

const TRANSACTION_COMPLETED = "transaction.completed";

const envelopeSchema = z.object({
  event_id: z.string().min(1),
  event_type: z.string(),
  occurred_at: z.iso.datetime({ offset: true }),
  data: z.unknown(),
});

const paddleTransactionSchema = z.object({
  id: z.string().min(1),
  subscription_id: z.string().nullish(),
  customer_id: z.string().min(1).nullish(),
  custom_data: paddleCustomDataSchema,
  items: z.array(
    z.object({
      price: z.object({ id: z.string().min(1) }),
      quantity: z.number().int().positive().optional(),
    }),
  ),
});

export type PaddleWebhookOptions = {
  readonly priceToTier: Readonly<Record<string, string>>;
  /** Prices a one-off payment may credit; Paddle.js lets a browser open checkouts with any customData. */
  readonly oneOffPriceIds: readonly string[];
  /** Test seam: Unix seconds. Defaults to the wall clock. */
  readonly nowSeconds?: () => number;
};

function currentUnixSeconds(): number {
  return Math.floor(Temporal.Now.instant().epochMilliseconds / 1000);
}

export function tenantIdOf(
  customData: Readonly<Record<string, unknown>> | null | undefined,
): string | undefined {
  const tenantId = customData?.["tenantId"];
  return typeof tenantId === "string" && tenantId.length > 0 ? tenantId : undefined;
}

function parsePaymentEvent(
  providerEventId: string,
  data: unknown,
  oneOffPriceIds: readonly string[],
): PaymentEvent | null {
  const parsed = paddleTransactionSchema.safeParse(data);
  if (!parsed.success) return null;
  const transaction = parsed.data;
  // A subscription's own payments are covered by its subscription.* events.
  if (transaction.subscription_id) return null;
  const priceId = transaction.items[0]?.price.id;
  const quantity = transaction.items[0]?.quantity ?? 1;
  const tenantId = tenantIdOf(transaction.custom_data);
  if (!tenantId || !priceId || !transaction.customer_id) return null;
  if (!oneOffPriceIds.includes(priceId)) {
    createFallbackLogger("subscription-paddle").warn(
      "paddle one-off transaction dropped: price is not an allowed one-off price",
      { providerEventId, priceId },
    );
    return null;
  }
  return {
    kind: BillingEventKinds.payment,
    providerEventId,
    providerName: PADDLE_PROVIDER_NAME,
    tenantId,
    providerCheckoutId: transaction.id,
    providerCustomerId: transaction.customer_id,
    priceId,
    quantity,
  };
}

// Subscription prices are meant to be quantity 1; the tier is still set, but a
// different quantity is worth an operator's attention. Event id and quantity only.
function warnOnUnexpectedQuantity(
  providerEventId: string,
  items: readonly { readonly quantity?: number | undefined }[],
): void {
  for (const item of items) {
    if (item.quantity !== undefined && item.quantity !== 1) {
      createFallbackLogger("subscription-paddle").warn(
        "paddle subscription item quantity is not 1; the tier is still set",
        { providerEventId, quantity: item.quantity },
      );
    }
  }
}

function parseSubscriptionEvent(
  providerEventId: string,
  type: SubscriptionEventType,
  providerEventAt: string,
  data: unknown,
  priceToTier: Readonly<Record<string, string>>,
): SubscriptionEvent | null {
  const parsed = paddleSubscriptionSchema.safeParse(data);
  if (!parsed.success) return null;
  const sub = parsed.data;
  const tenantId = tenantIdOf(sub.custom_data);
  const state = mapPaddleSubscriptionState(sub, priceToTier);
  if (!tenantId || !state) return null;
  warnOnUnexpectedQuantity(providerEventId, sub.items);
  return {
    providerEventId,
    providerName: PADDLE_PROVIDER_NAME,
    type,
    tenantId,
    ...(sub.transaction_id && { providerCheckoutId: sub.transaction_id }),
    providerCustomerId: sub.customer_id,
    providerSubscriptionId: sub.id,
    providerEventAt,
    ...state,
  };
}

// Events whose custom_data still carries the pre-ledger tenantBinding: they belong to a checkout
// the backfill sweep may not have ledgered yet. Kept beside the event, not on it, because
// billing-foundation must not know about the legacy binding.
const legacyBindingEvents = new WeakSet<object>();

export function hasLegacyTenantBinding(event: SubscriptionEvent | PaymentEvent): boolean {
  return legacyBindingEvents.has(event);
}

function markLegacyBinding<T extends SubscriptionEvent | PaymentEvent | null>(
  event: T,
  data: unknown,
): T {
  if (
    event !== null &&
    typeof propertyOf(propertyOf(data, "custom_data"), "tenantBinding") === "string"
  ) {
    legacyBindingEvents.add(event);
  }
  return event;
}

export function verifyAndParsePaddleWebhook(
  runtime: PaddleWebhookRuntime,
  options: PaddleWebhookOptions,
): (
  rawBody: string,
  headers: Record<string, string>,
  systemSecrets?: SecretsContext,
) => Promise<SubscriptionEvent | PaymentEvent | null> {
  const nowSeconds = options.nowSeconds ?? currentUnixSeconds;
  return async (rawBody, headers, systemSecrets) => {
    const secret = await runtime.resolveWebhookSecret(systemSecrets);
    verifyPaddleSignature(rawBody, headers, secret, nowSeconds());

    // Past verification the body is trusted to be Paddle's; a malformed shape is
    // schema drift, so it is dropped (200 ignored) instead of answered with a 401.
    const envelope = envelopeSchema.safeParse(
      parseJsonOrThrow<unknown>(rawBody, "subscription-paddle webhook body"),
    );
    if (!envelope.success) return null;

    const { event_id: providerEventId, event_type: type, occurred_at, data } = envelope.data;
    if (type === TRANSACTION_COMPLETED) {
      return markLegacyBinding(
        parsePaymentEvent(providerEventId, data, options.oneOffPriceIds),
        data,
      );
    }
    if (!Object.hasOwn(PADDLE_SUBSCRIPTION_EVENT_TYPES, type)) return null;
    const normalizedType = PADDLE_SUBSCRIPTION_EVENT_TYPES[type];
    if (!normalizedType) return null;
    return markLegacyBinding(
      parseSubscriptionEvent(
        providerEventId,
        normalizedType,
        occurred_at,
        data,
        options.priceToTier,
      ),
      data,
    );
  };
}
