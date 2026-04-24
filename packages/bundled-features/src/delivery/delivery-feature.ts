import { defineFeature, type FeatureDefinition } from "@kumiko/framework/engine";
import type { z } from "zod";
import { DELIVERY_ATTEMPT_EVENT } from "./constants";
import { deliveryAttemptSchema } from "./delivery-feature-schemas";
import { logQuery } from "./handlers/log.query";
import { preferencesQuery } from "./handlers/preferences.query";
import { setPreferenceWrite } from "./handlers/set-preference.write";
import { deliveryAttemptsTable, notificationPreferenceEntity } from "./tables";

export function createDeliveryFeature(): FeatureDefinition {
  return defineFeature("delivery", (r) => {
    r.systemScope();
    r.entity("notificationPreference", notificationPreferenceEntity);

    // Events-only projection source: "deliveryAttempt" is the aggregate-
    // type on the events-table, but there's no r.entity for it — each
    // attempt is a fresh stream, no CRUD lifecycle. Framework's
    // boot-validator accepts the projection below because at least one
    // apply-key is a registered domain-event (DELIVERY_ATTEMPT_EVENT).
    r.defineEvent("attempt", deliveryAttemptSchema);

    // Inline projection that materialises every delivery attempt into
    // deliveryAttemptsTable. Runs in the SAME transaction as the low-level
    // append(), so callers see their write immediately — no dispatcher
    // drain needed in tests. Chosen over a MultiStreamProjection because
    // delivery-log is a hot read-path for admin/audit UIs that expect
    // read-your-own-write semantics.
    r.projection({
      name: "delivery-log",
      source: "deliveryAttempt",
      table: deliveryAttemptsTable,
      apply: {
        [DELIVERY_ATTEMPT_EVENT]: async (event, tx) => {
          const p = event.payload as z.infer<typeof deliveryAttemptSchema>;
          await tx.insert(deliveryAttemptsTable).values({
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
