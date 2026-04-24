import { defineFeature, type FeatureDefinition } from "@kumiko/framework/engine";
import { z } from "zod";
import { DELIVERY_ATTEMPT_EVENT, DeliveryStatus } from "./constants";
import { logQuery } from "./handlers/log.query";
import { preferencesQuery } from "./handlers/preferences.query";
import { setPreferenceWrite } from "./handlers/set-preference.write";
import { deliveryAttemptEntity, deliveryLogTable, notificationPreferenceEntity } from "./tables";

// Mirror of DeliveryLogEntry (minus tenantId — that rides the event
// envelope) so the event payload is schema-validated. The delivery-log
// MSP below inserts each event verbatim into deliveryLogTable.
const deliveryAttemptSchema = z.object({
  notificationType: z.string(),
  channel: z.string(),
  recipientId: z.string().nullable(),
  recipientAddress: z.string().nullable(),
  status: z.enum([DeliveryStatus.sent, DeliveryStatus.failed, DeliveryStatus.skipped]),
  error: z.string().nullable(),
});

export function createDeliveryFeature(): FeatureDefinition {
  return defineFeature("delivery", (r) => {
    r.systemScope();
    r.entity("notificationPreference", notificationPreferenceEntity);
    // Shape-anchor entity for the inline delivery-log projection (see
    // tables.ts). Never instantiated — no executor, no table-push — but
    // r.projection requires a registered entity as `source`, so the entity
    // exists for registry-validation purposes.
    r.entity("deliveryAttempt", deliveryAttemptEntity);

    // Event-schema registration — the service layer uses low-level append()
    // (it runs outside the dispatcher ctx) so the schema-validation doesn't
    // kick in at write-time, but r.defineEvent makes the event-type
    // discoverable for ops tools, the audit-feature, and any later
    // migration to ctx.appendEvent.
    r.defineEvent("attempt", deliveryAttemptSchema);

    // Inline projection that materialises every delivery attempt into
    // deliveryLogTable. Runs in the SAME transaction as the low-level
    // append(), so callers see their write immediately — no dispatcher
    // drain needed in tests. Chosen over a MultiStreamProjection because
    // delivery-log is a hot read-path for admin/audit UIs that expect
    // read-your-own-write semantics.
    r.projection({
      name: "delivery-log",
      source: "deliveryAttempt",
      table: deliveryLogTable,
      apply: {
        [DELIVERY_ATTEMPT_EVENT]: async (event, tx) => {
          const p = event.payload as z.infer<typeof deliveryAttemptSchema>;
          await tx.insert(deliveryLogTable).values({
            tenantId: event.tenantId,
            notificationType: p.notificationType,
            channel: p.channel,
            recipientId: p.recipientId,
            recipientAddress: p.recipientAddress,
            status: p.status,
            error: p.error,
          });
        },
      },
    });

    // Extension points: channels and renderers register as features
    r.extendsRegistrar("deliveryChannel", {
      onRegister: () => {},
    });
    r.extendsRegistrar("notificationRenderer", {
      onRegister: () => {},
    });

    const handlers = {
      setPreference: r.writeHandler(setPreferenceWrite),
    };

    const queries = {
      log: r.queryHandler(logQuery),
      preferences: r.queryHandler(preferencesQuery),
    };

    return { handlers, queries };
  });
}
