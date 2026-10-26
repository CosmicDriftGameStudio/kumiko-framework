// Paddle webhook: signature check, then mapping of Paddle's event envelope onto
// the foundation's normalized events. Events without a valid tenant binding are
// dropped (200 ignored): see tenant-binding.ts.

import {
  BillingEventKinds,
  type PaymentEvent,
  type SubscriptionEvent,
  type SubscriptionEventType,
  SubscriptionEventTypes,
} from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import { parseJsonOrThrow } from "@cosmicdrift/kumiko-framework/utils";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { PADDLE_PROVIDER_NAME } from "./constants.ts";
import type { PaddleWebhookRuntime } from "./runtime.ts";
import {
  mapPaddleSubscriptionState,
  paddleCustomDataSchema,
  paddleSubscriptionSchema,
} from "./subscription-state.ts";
import { boundTenantOf } from "./tenant-binding.ts";
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
  items: z.array(z.object({ price: z.object({ id: z.string().min(1) }) })),
});

export type PaddleWebhookOptions = {
  readonly priceToTier: Readonly<Record<string, string>>;
  /** Test seam: Unix seconds. Defaults to the wall clock. */
  readonly nowSeconds?: () => number;
};

function currentUnixSeconds(): number {
  return Math.floor(Temporal.Now.instant().epochMilliseconds / 1000);
}

function parsePaymentEvent(
  providerEventId: string,
  data: unknown,
  bindingKey: string,
): PaymentEvent | null {
  const parsed = paddleTransactionSchema.safeParse(data);
  if (!parsed.success) return null;
  const transaction = parsed.data;
  // A subscription's own payments are covered by its subscription.* events.
  if (transaction.subscription_id) return null;
  const priceId = transaction.items[0]?.price.id;
  const bound = boundTenantOf(transaction.custom_data, bindingKey);
  if (!bound || !priceId || !transaction.customer_id) return null;
  return {
    kind: BillingEventKinds.payment,
    providerEventId,
    providerName: PADDLE_PROVIDER_NAME,
    tenantId: bound.tenantId,
    ...(bound.consentId !== undefined && { consentId: bound.consentId }),
    providerCheckoutId: transaction.id,
    providerCustomerId: transaction.customer_id,
    priceId,
  };
}

function parseSubscriptionEvent(
  providerEventId: string,
  type: SubscriptionEventType,
  providerEventAt: string,
  data: unknown,
  options: { readonly priceToTier: Readonly<Record<string, string>>; readonly bindingKey: string },
): SubscriptionEvent | null {
  const parsed = paddleSubscriptionSchema.safeParse(data);
  if (!parsed.success) return null;
  const sub = parsed.data;
  const bound = boundTenantOf(sub.custom_data, options.bindingKey);
  const state = mapPaddleSubscriptionState(sub, options.priceToTier);
  if (!bound || !state) return null;
  return {
    providerEventId,
    providerName: PADDLE_PROVIDER_NAME,
    type,
    tenantId: bound.tenantId,
    ...(bound.consentId !== undefined && { consentId: bound.consentId }),
    providerCustomerId: sub.customer_id,
    providerSubscriptionId: sub.id,
    providerEventAt,
    ...state,
  };
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
    // After verification only: an unauthenticated request must not trigger a second secret read.
    const bindingKey = await runtime.resolveTenantBindingKey(systemSecrets);

    // Past verification the body is trusted to be Paddle's; a malformed shape is
    // schema drift, so it is dropped (200 ignored) instead of answered with a 401.
    const envelope = envelopeSchema.safeParse(
      parseJsonOrThrow<unknown>(rawBody, "subscription-paddle webhook body"),
    );
    if (!envelope.success) return null;

    const { event_id: providerEventId, event_type: type, occurred_at, data } = envelope.data;
    if (type === TRANSACTION_COMPLETED) return parsePaymentEvent(providerEventId, data, bindingKey);
    if (!Object.hasOwn(PADDLE_SUBSCRIPTION_EVENT_TYPES, type)) return null;
    const normalizedType = PADDLE_SUBSCRIPTION_EVENT_TYPES[type];
    if (!normalizedType) return null;
    return parseSubscriptionEvent(providerEventId, normalizedType, occurred_at, data, {
      priceToTier: options.priceToTier,
      bindingKey,
    });
  };
}
