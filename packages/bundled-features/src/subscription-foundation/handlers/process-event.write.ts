// process-event — programmatic write-handler den der webhook-handler
// (createSubscriptionWebhookHandler) aufruft NACHDEM Plugin den raw-body
// verifiziert + zu SubscriptionEvent normalisiert hat.
//
// Macht in einem Atomzug:
//   1. Insert subscription-event (deterministic aggregate-id =
//      Idempotency-Anker)
//   2. Upsert subscription (deterministic aggregate-id per tenant,
//      try-create / executor-update analog cap-counter increment)
//
// Beide Schritte laufen in derselben dispatcher-Transaktion — System-
// Crash → rollback aller Schritte → Provider-Retry kommt sauber durch.
//
// **NICHT** macht: Tier-Sync zum tier-engine. Das ist ein separater
// optionaler Schritt — nicht jede subscription-foundation-Mount braucht
// auch tier-engine. App-Owner ruft im eigenen post-process-hook ggf.
// `tier-engine:write:upsert-tier-assignment` mit dem aufgelösten tier.

import { createEntityExecutor, type WriteHandlerDef } from "@kumiko/framework/engine";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { subscriptionAggregateId, subscriptionEventAggregateId } from "../aggregate-id";
import { SubscriptionEventTypes, SubscriptionStatuses } from "../constants";
import { subscriptionEntity, subscriptionEventEntity } from "../entities";

const { table: subTable, executor: subExecutor } = createEntityExecutor(
  "subscription",
  subscriptionEntity,
);
const { table: eventTable, executor: eventExecutor } = createEntityExecutor(
  "subscription-event",
  subscriptionEventEntity,
);

// =============================================================================
// Input-Schema = der normalisierte SubscriptionEvent (ohne tenantId, der
// kommt aus event.user.tenantId — der webhook-handler setzt den
// programmatic-user mit der vom Plugin aufgelösten tenantId).
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
  providerCustomerId: z.string().min(1).max(200),
  providerSubscriptionId: z.string().min(1).max(200),
  status: statusSchema,
  tier: z.string().min(1).max(50),
  currentPeriodEndIso: z.string().min(1),
  rawPayload: z.string().min(1).max(100_000),
});
type ProcessEventPayload = z.infer<typeof processEventSchema>;

// =============================================================================
// Handler
// =============================================================================
//
// SystemAdmin-only: dieser handler wird ausschließlich vom programmatic
// webhook-handler aufgerufen (mit einem internal SystemUser), nie vom
// Tenant-Admin direkt. Audit-Row dokumentiert "subsystem hat es geschrieben".
export const processEventHandler: WriteHandlerDef = {
  name: "process-event",
  schema: processEventSchema,
  access: { roles: ["SystemAdmin"] },
  handler: async (event, ctx) => {
    // @cast-boundary engine-payload — dispatcher-zod-validated payload
    const payload = event.payload as ProcessEventPayload;
    const tenantId = event.user.tenantId;

    // ---------------------------------------------------------------
    // 1. Idempotency-Check: existiert schon ein subscription-event mit
    //    diesem aggregate-id? Wenn ja → duplicate, early-return.
    //
    //    **Pattern: exists-check VOR create** statt try/catch um den
    //    create. Reason: Postgres setzt die TX in abort-state nach
    //    einem fehlgeschlagenen INSERT (UNIQUE-violation oder
    //    version_conflict); ein folgendes SELECT wirft "current
    //    transaction is aborted". Im Dispatcher öffnet jeder write-
    //    handler eine eigene TX, also würde der ganze handler abbrechen.
    //    Same approach wie cap-counter increment.
    // ---------------------------------------------------------------
    const eventAggregateId = subscriptionEventAggregateId(
      tenantId,
      payload.providerName,
      payload.providerEventId,
    );
    const existingEvent = await ctx.db
      .select()
      .from(eventTable)
      .where(eq(eventTable["id"], eventAggregateId))
      .limit(1);
    if (existingEvent.length > 0) {
      return {
        isSuccess: true as const,
        data: { duplicate: true as const, eventAggregateId },
      };
    }

    await eventExecutor.create(
      {
        id: eventAggregateId,
        providerName: payload.providerName,
        providerEventId: payload.providerEventId,
        eventType: payload.type,
        receivedAt: ctx.tz?.now() ?? Temporal.Now.instant(),
        rawPayload: payload.rawPayload,
      },
      event.user,
      ctx.db,
    );

    // ---------------------------------------------------------------
    // 2. Upsert subscription. Aggregate-id ist deterministic per
    //    tenantId — eine subscription-row pro Tenant.
    // ---------------------------------------------------------------
    const subAggId = subscriptionAggregateId(tenantId);
    const existing = await ctx.db
      .select()
      .from(subTable)
      .where(eq(subTable["id"], subAggId))
      .limit(1);

    const subscriptionFields = {
      providerName: payload.providerName,
      providerCustomerId: payload.providerCustomerId,
      providerSubscriptionId: payload.providerSubscriptionId,
      status: payload.status,
      tier: payload.tier,
      currentPeriodEnd: payload.currentPeriodEndIso,
    };

    if (existing.length === 0) {
      await subExecutor.create({ id: subAggId, ...subscriptionFields }, event.user, ctx.db);
    } else {
      const row = existing[0];
      if (!row) {
        throw new Error(
          "subscription-foundation: subscription row vanished between length-check and read",
        );
      }
      const currentVersion = row["version"] as number;
      await subExecutor.update(
        {
          id: subAggId,
          version: currentVersion,
          changes: subscriptionFields,
        },
        event.user,
        ctx.db,
      );
    }

    return {
      isSuccess: true as const,
      data: {
        duplicate: false as const,
        eventAggregateId,
        subscriptionAggregateId: subAggId,
      },
    };
  },
};
