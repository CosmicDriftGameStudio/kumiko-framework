// process-event — programmatic write handler called by the webhook handler
// (createSubscriptionWebhookRoute) AFTER the plugin has verified the raw body
// and normalized it into a SubscriptionEvent.
//
// **ES pattern:**
//   1. Idempotency check: loads the subscription stream and scans for an
//      already-seen `metadata.providerEventId`. A provider replay
//      (Stripe retry storm) has the same event ID → duplicate=true,
//      with no second append.
//   2. Admission (handler only, not the shared append): `created` needs a
//      checkout from the server's ledger; every other type needs the tenant's
//      current subscription or a ledgered checkout. Else the event is ignored.
//   3. Type mapping: SubscriptionEvent.type (= normalized by the plugin)
//      → one of the 5 ES event types.
//   4. ctx.events.unsafeAppend — the inline projection materializes the
//      `read_subscriptions` row in the same TX.

import {
  configuredPiiSubjectKms,
  encryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { HandlerContext, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import * as z from "zod";
import { subscriptionAggregateId } from "../aggregate-id.ts";
import { findProviderPlugin } from "../checkout-core.ts";
import {
  findCheckoutOpened,
  type IgnoredEventReason,
  IgnoredEventReasons,
} from "../checkout-ledger.ts";
import { SUBSCRIPTION_PII_FIELDS, subscriptionEntity } from "../entities.ts";
import {
  CHECKOUT_CONSENT_RECORDED_EVENT_QN,
  type CheckoutOpenedPayload,
  checkoutConsentRecordedPayloadSchema,
  INVOICE_PAID_EVENT_QN,
  INVOICE_PAYMENT_FAILED_EVENT_QN,
  PROVIDER_ID_MAX_CHARS,
  SUBSCRIPTION_AGGREGATE_TYPE,
  SUBSCRIPTION_CANCELED_EVENT_QN,
  SUBSCRIPTION_CREATED_EVENT_QN,
  SUBSCRIPTION_UPDATED_EVENT_QN,
  type SubscriptionEventHeaders,
  type SubscriptionEventPayload,
} from "../events.ts";
import { getSubscriptionForTenant, type SubscriptionView } from "../get-subscription-for-tenant.ts";
import { hasSeenProviderEvent } from "../provider-event-seen.ts";
import {
  BILLING_SUBSCRIPTION_LOCK_NAMESPACE,
  isSubscriptionBlockingCheckout,
  isSwitchableSubscriptionStatus,
  SubscriptionEventTypes,
  SubscriptionStatuses,
} from "../web/constants.ts";

// =============================================================================
// Input schema = the normalized SubscriptionEvent (without tenantId, which
// comes from event.user.tenantId — the webhook handler sets the
// programmatic user with the tenantId resolved by the plugin).
// =============================================================================

const eventTypeSchema = z.enum([
  SubscriptionEventTypes.created,
  SubscriptionEventTypes.updated,
  SubscriptionEventTypes.canceled,
  SubscriptionEventTypes.invoicePaid,
  SubscriptionEventTypes.invoicePaymentFailed,
]);

const statusSchema = z.enum([
  SubscriptionStatuses.active,
  SubscriptionStatuses.trialing,
  SubscriptionStatuses.pastDue,
  SubscriptionStatuses.canceled,
  SubscriptionStatuses.incomplete,
]);

export const processEventSchema = z.object({
  providerEventId: z.string().min(1).max(200),
  providerName: z.string().min(1).max(50),
  type: eventTypeSchema,
  providerCustomerId: z.string().min(1).max(PROVIDER_ID_MAX_CHARS),
  providerSubscriptionId: z.string().min(1).max(PROVIDER_ID_MAX_CHARS),
  status: statusSchema,
  tier: z.string().min(1).max(50),
  currentPeriodEndIso: z.string().min(1),
  cancelAtIso: z.string().min(1).nullable().optional(),
  providerEventAtIso: z.iso.datetime().optional(),
  providerCheckoutId: z.string().min(1).max(200).optional(),
});
export type ProcessEventPayload = z.infer<typeof processEventSchema>;

// Map normalized SubscriptionEventType → fully-qualified ES event-name.
const NORMALIZED_TO_ES_EVENT: Readonly<Record<string, string>> = {
  [SubscriptionEventTypes.created]: SUBSCRIPTION_CREATED_EVENT_QN,
  [SubscriptionEventTypes.updated]: SUBSCRIPTION_UPDATED_EVENT_QN,
  [SubscriptionEventTypes.canceled]: SUBSCRIPTION_CANCELED_EVENT_QN,
  [SubscriptionEventTypes.invoicePaid]: INVOICE_PAID_EVENT_QN,
  [SubscriptionEventTypes.invoicePaymentFailed]: INVOICE_PAYMENT_FAILED_EVENT_QN,
} satisfies Readonly<Record<string, string>>;

const STATE_EVENT_QNS: ReadonlySet<string> = new Set([
  SUBSCRIPTION_CREATED_EVENT_QN,
  SUBSCRIPTION_UPDATED_EVENT_QN,
  SUBSCRIPTION_CANCELED_EVENT_QN,
]);

const STATE_EVENT_TYPES: ReadonlySet<string> = new Set([
  SubscriptionEventTypes.created,
  SubscriptionEventTypes.updated,
  SubscriptionEventTypes.canceled,
]);

export function isLateStateEvent(
  storedEvents: readonly {
    readonly payload: unknown;
    readonly metadata: { readonly headers?: Record<string, unknown> };
  }[],
  payload: ProcessEventPayload,
): boolean {
  if (payload.providerEventAtIso === undefined || !STATE_EVENT_TYPES.has(payload.type)) {
    return false;
  }
  const incoming = Temporal.Instant.from(payload.providerEventAtIso);
  return storedEvents.some((stored) => {
    const storedAt = propertyOf(stored.payload, "providerEventAtIso");
    if (stored.metadata.headers?.["providerName"] !== payload.providerName) return false;
    if (typeof storedAt !== "string") return false;
    // A stored value that does not parse can never prove a newer event; skip it instead of
    // failing every later delivery of this tenant's stream.
    try {
      const order = Temporal.Instant.compare(Temporal.Instant.from(storedAt), incoming);
      if (order !== 0) return order > 0;
      // Provider timestamps have second resolution: on a tie a stored cancellation wins over
      // a non-terminal state, so a reordered same-second `updated` cannot revive a canceled one.
      return (
        propertyOf(stored.payload, "status") === SubscriptionStatuses.canceled &&
        payload.status !== SubscriptionStatuses.canceled
      );
    } catch {
      return false;
    }
  });
}

// =============================================================================
// appendSubscriptionEvent — the append-body, shared by processEventHandler
// (webhook path) and sync-subscription.write.ts (backfill path). Both call
// this with the same normalized payload shape; the difference is only in
// who constructs `payload` and what `providerEventId` they use.
// =============================================================================

type SubscriptionStreamEvent = Awaited<ReturnType<HandlerContext["events"]["load"]>>[number];

async function lockAndLoadSubscriptionStream(
  ctx: HandlerContext,
  aggId: string,
): Promise<readonly SubscriptionStreamEvent[]> {
  await ctx.db.advisoryXactLock(BILLING_SUBSCRIPTION_LOCK_NAMESPACE, aggId);
  return ctx.events.load(aggId);
}

// A provider timestamp far in the future would make every later, genuine event look late.
const PROVIDER_EVENT_CLOCK_SKEW_SECONDS = 300;

export function clampProviderEventAt(
  payload: ProcessEventPayload,
  now: Temporal.Instant,
): ProcessEventPayload {
  if (payload.providerEventAtIso === undefined) return payload;
  const ceiling = now.add({ seconds: PROVIDER_EVENT_CLOCK_SKEW_SECONDS });
  return Temporal.Instant.compare(Temporal.Instant.from(payload.providerEventAtIso), ceiling) > 0
    ? { ...payload, providerEventAtIso: ceiling.toString() }
    : payload;
}

export async function appendSubscriptionEvent(
  ctx: HandlerContext,
  tenantId: string,
  rawPayload: ProcessEventPayload,
  now: Temporal.Instant = Temporal.Now.instant(),
  consentId?: string,
  lockedStream?: readonly SubscriptionStreamEvent[],
): Promise<{
  readonly duplicate: boolean;
  readonly stale?: true;
  readonly subscriptionAggregateId: string;
}> {
  const aggId = subscriptionAggregateId(tenantId);
  const payload = clampProviderEventAt(rawPayload, now);

  // The lock serialises the read (idempotency + late check) with the append: the append re-reads the
  // stream version itself, so without it a concurrent delivery could slip in between and the late
  // check would have judged an outdated stream. A caller that already holds it passes its stream.

  // ---------------------------------------------------------------
  // 1. Idempotency: load the subscription stream and check whether this
  //    providerEventId was already seen. A provider retry storm (Stripe
  //    resends up to 5x within 4h) hits the same stream and finds the
  //    event id in metadata.
  //
  //    **Performance caveat:** O(N) per stream. With 5 years of history
  //    (monthly recurring = ~60 events) still <50ms. For much longer
  //    streams, optimize via snapshot or a per-tenant dedup table as the
  //    idempotency anchor (like cap-counter).
  // ---------------------------------------------------------------
  const existingEvents = lockedStream ?? (await lockAndLoadSubscriptionStream(ctx, aggId));
  if (hasSeenProviderEvent(existingEvents, payload)) {
    return { duplicate: true, subscriptionAggregateId: aggId };
  }

  // A state event the provider emitted before the newest one already stored is a
  // late delivery: appending it would roll the row back (a canceled subscription
  // would come back active). Invoice events carry the live state, not a snapshot.
  if (isLateStateEvent(existingEvents, payload)) {
    ctx.obs.log?.warn(
      `[billing-foundation:process-event] dropped late ${payload.type} ${payload.providerEventId}: a newer provider event is already stored`,
    );
    return { duplicate: false, stale: true, subscriptionAggregateId: aggId };
  }

  // ---------------------------------------------------------------
  // 2. Map normalized event-type → ES event-FQN.
  // ---------------------------------------------------------------
  const esEventType = NORMALIZED_TO_ES_EVENT[payload.type];
  if (!esEventType) {
    // Schema validation above should already catch this; defensive against
    // drift between the SubscriptionEventTypes enum and the NORMALIZED map.
    throw new Error(`subscription-foundation: no ES event-type mapping for "${payload.type}"`);
  }

  // ---------------------------------------------------------------
  // 3. Encrypt the two provider-subject PII fields before they touch
  //    storage — this is the ONLY write path onto the subscription
  //    stream, so encrypting here covers both the event-log payload AND
  //    (via projection.ts copying the event fields as-is) the
  //    read_subscriptions row with a single call. The subject is the
  //    TENANT (tenantOwned) — tenant-destroy's subject-keys stage
  //    (eraseSubjectKeys) erases exactly this key, so both copies become
  //    genuinely unreadable once that stage runs, not just
  //    "encrypted at rest". No adapter configured = engine off (fields
  //    stay plaintext) — mirrors how the
  //    event-store-executor treats an absent piiKms().
  // ---------------------------------------------------------------
  const piiKms = configuredPiiSubjectKms();
  const encryptedFields = piiKms
    ? await encryptPiiFieldValues(
        {
          tenantId,
          providerCustomerId: payload.providerCustomerId,
          providerSubscriptionId: payload.providerSubscriptionId,
        },
        subscriptionEntity,
        SUBSCRIPTION_PII_FIELDS,
        piiKms,
        { requestId: `billing-foundation:process-event:${payload.providerEventId}`, tenantId },
        { tenantId, entityName: SUBSCRIPTION_AGGREGATE_TYPE },
      )
    : {
        providerCustomerId: payload.providerCustomerId,
        providerSubscriptionId: payload.providerSubscriptionId,
      };

  // ---------------------------------------------------------------
  // 4. Append the event onto the subscription stream. The inline projection
  //    materializes the read_subscriptions row in the same TX.
  // ---------------------------------------------------------------
  const eventPayload: SubscriptionEventPayload = {
    providerName: payload.providerName,
    providerCustomerId: encryptedFields.providerCustomerId,
    providerSubscriptionId: encryptedFields.providerSubscriptionId,
    status: payload.status,
    tier: payload.tier,
    currentPeriodEndIso: payload.currentPeriodEndIso,
    ...(payload.cancelAtIso !== undefined && { cancelAtIso: payload.cancelAtIso }),
    ...(consentId !== undefined && { consentId }),
    ...(payload.providerEventAtIso !== undefined && {
      providerEventAtIso: payload.providerEventAtIso,
    }),
  };
  const headers: SubscriptionEventHeaders = {
    providerEventId: payload.providerEventId,
    providerName: payload.providerName,
  };
  await ctx.events.unsafeAppend({
    aggregateId: aggId,
    aggregateType: SUBSCRIPTION_AGGREGATE_TYPE,
    type: esEventType,
    payload: eventPayload,
    headers,
  });

  return { duplicate: false, subscriptionAggregateId: aggId };
}

// =============================================================================
// Handler
// =============================================================================
//
// SystemAdmin-only: this handler is called exclusively by the programmatic
// webhook handler (with an internal SystemUser), never directly by the
// tenant admin.
// One subscription aggregate exists per tenant, but a tenant can legitimately hold two provider
// subscriptions over time (a stale `incomplete` one superseded by a fresh checkout). A late or
// retried event of the old subscription must not overwrite the row of the live one, so an event of a
// different provider subscription only replaces a row that no longer blocks a checkout. The exception
// is a `created` of a subscription that is itself live (a provider switch); a late `created` of a
// never-completed `incomplete` one stays stale, since delivery order is not guaranteed.
function isStaleSubscriptionEvent(
  current: SubscriptionView | null,
  payload: ProcessEventPayload,
  now: Temporal.Instant,
): boolean {
  if (current === null) return false;
  const sameSubscription =
    current.providerName === payload.providerName &&
    current.providerSubscriptionId === payload.providerSubscriptionId;
  if (sameSubscription || !isSubscriptionBlockingCheckout(current, now)) return false;
  const supersedesCurrent =
    payload.type === SubscriptionEventTypes.created &&
    isSwitchableSubscriptionStatus(payload.status);
  return !supersedesCurrent;
}

type Admission =
  | { readonly admitted: true; readonly consentId?: string }
  | { readonly admitted: false; readonly reason: IgnoredEventReason; readonly retry?: true };

function isBoundToLedgerEntry(
  ctx: HandlerContext,
  entry: CheckoutOpenedPayload,
  payload: ProcessEventPayload,
): boolean {
  const plugin = findProviderPlugin(ctx, payload.providerName)?.plugin;
  return plugin?.priceToTier?.[entry.priceId] === payload.tier;
}

// A plan switch has no checkout of its own: its consent is the newest one recorded for the target
// tier, as long as no stored subscription event carries it yet. No window by state events: another
// state event (renewal, status change) may arrive between the consent and the tier change. The age
// limit keeps an abandoned consent from being attached to a portal switch months later.
const SWITCH_CONSENT_MAX_AGE_HOURS = 24;

function providerEventInstant(payload: ProcessEventPayload, now: Temporal.Instant) {
  const iso = clampProviderEventAt(payload, now).providerEventAtIso;
  return iso === undefined ? now : Temporal.Instant.from(iso);
}

function pendingSwitchConsentId(
  storedEvents: readonly SubscriptionStreamEvent[],
  payload: ProcessEventPayload,
  now: Temporal.Instant,
): string | undefined {
  const referenceAt = providerEventInstant(payload, now);
  const oldestAcceptedAt = referenceAt.subtract({ hours: SWITCH_CONSENT_MAX_AGE_HOURS });
  const carried = new Set<string>();
  for (const stored of storedEvents) {
    // skip: only subscription state events can carry a consent
    if (!STATE_EVENT_QNS.has(stored.type)) continue;
    const consentId = propertyOf(stored.payload, "consentId");
    if (typeof consentId === "string") carried.add(consentId);
  }
  for (let index = storedEvents.length - 1; index >= 0; index--) {
    const stored = storedEvents[index];
    if (stored?.type !== CHECKOUT_CONSENT_RECORDED_EVENT_QN) continue;
    if (Temporal.Instant.compare(stored.createdAt, oldestAcceptedAt) < 0) continue;
    const parsed = checkoutConsentRecordedPayloadSchema.safeParse(stored.payload);
    if (!parsed.success) continue;
    const consent = parsed.data;
    if (
      consent.mode === "subscription" &&
      consent.tier === payload.tier &&
      (consent.providerName === undefined || consent.providerName === payload.providerName) &&
      !carried.has(consent.consentId)
    ) {
      return consent.consentId;
    }
  }
  return undefined;
}

// A `created` that never comes (subscription from before the ledger, foreign custom_data, deleted
// subscription) would otherwise answer 503 until the provider gives up, and Stripe disables an
// endpoint that keeps failing. Only a young event may still be overtaken by its `created`.
// A provider that sends no event time (mollie) cannot be aged and keeps retrying.
const MISSING_SUBSCRIPTION_RETRY_WINDOW_MINUTES = 60;

function isWithinMissingSubscriptionRetryWindow(
  payload: ProcessEventPayload,
  now: Temporal.Instant,
): boolean {
  if (payload.providerEventAtIso === undefined) return true;
  const oldestRetriedAt = now.subtract({ minutes: MISSING_SUBSCRIPTION_RETRY_WINDOW_MINUTES });
  return Temporal.Instant.compare(providerEventInstant(payload, now), oldestRetriedAt) >= 0;
}

function admitProviderEvent(
  ctx: HandlerContext,
  storedEvents: readonly SubscriptionStreamEvent[],
  current: SubscriptionView | null,
  payload: ProcessEventPayload,
  now: Temporal.Instant,
): Admission {
  const entry =
    payload.providerCheckoutId === undefined
      ? undefined
      : findCheckoutOpened(storedEvents, {
          providerName: payload.providerName,
          providerCheckoutId: payload.providerCheckoutId,
          mode: "subscription",
        });
  if (entry !== undefined && isBoundToLedgerEntry(ctx, entry, payload)) {
    return { admitted: true, ...(entry.consentId !== undefined && { consentId: entry.consentId }) };
  }
  if (payload.type === SubscriptionEventTypes.created) {
    return { admitted: false, reason: IgnoredEventReasons.checkoutNotInLedger };
  }
  // The provider does not guarantee order: an update that beats the `created` of its
  // subscription must be redelivered, not dropped.
  if (current === null) {
    return {
      admitted: false,
      reason: IgnoredEventReasons.subscriptionNotYetCreated,
      ...(isWithinMissingSubscriptionRetryWindow(payload, now) && { retry: true }),
    };
  }
  const isCurrentSubscription =
    current.providerName === payload.providerName &&
    current.providerSubscriptionId === payload.providerSubscriptionId;
  if (!isCurrentSubscription)
    return { admitted: false, reason: IgnoredEventReasons.foreignSubscription };
  const switchConsentId =
    payload.type === SubscriptionEventTypes.updated && current.tier !== payload.tier
      ? pendingSwitchConsentId(storedEvents, payload, now)
      : undefined;
  return { admitted: true, ...(switchConsentId !== undefined && { consentId: switchConsentId }) };
}

export function createProcessEventHandler(now: () => Temporal.Instant): WriteHandlerDef {
  return {
    name: "process-event",
    agent: { expose: false },
    schema: processEventSchema,
    access: { roles: ["SystemAdmin"] },
    handler: async (event, ctx) => {
      // @cast-boundary engine-payload — dispatcher-zod-validated payload
      const payload = event.payload as ProcessEventPayload;
      const aggId = subscriptionAggregateId(event.user.tenantId);
      // One locked load serves admission and the append; the stream grows with every opened checkout.
      // The lock comes first so the stream and `current` are both read under it.
      const stream = await lockAndLoadSubscriptionStream(ctx, aggId);
      const current = await getSubscriptionForTenant(ctx, event.user.tenantId);
      const admission = admitProviderEvent(ctx, stream, current, payload, now());
      if (!admission.admitted) {
        ctx.obs.log?.warn(
          `[billing-foundation:process-event] ignored ${payload.type} ${payload.providerEventId} (${admission.reason}): provider ${payload.providerName}`,
        );
        return {
          isSuccess: true as const,
          data: {
            ignored: true as const,
            reason: admission.reason,
            ...(admission.retry === true && { retry: true as const }),
            subscriptionAggregateId: aggId,
          },
        };
      }
      if (isStaleSubscriptionEvent(current, payload, now())) {
        ctx.obs.log?.warn(
          `[billing-foundation:process-event] dropped stale ${payload.type} ${payload.providerEventId}: tenant already tracks another subscription`,
        );
        return {
          isSuccess: true as const,
          data: { duplicate: false, stale: true, subscriptionAggregateId: aggId },
        };
      }
      const result = await appendSubscriptionEvent(
        ctx,
        event.user.tenantId,
        payload,
        now(),
        admission.consentId,
        stream,
      );
      return { isSuccess: true as const, data: result };
    },
  };
}
