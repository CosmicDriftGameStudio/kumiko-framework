import { insertOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import type { z } from "zod";
import { DELIVERY_ATTEMPT_EVENT } from "./constants";
import { deliveryAttemptSchema } from "./events";
import { logQuery } from "./handlers/log.query";
import { preferencesQuery } from "./handlers/preferences.query";
import { setPreferenceWrite } from "./handlers/set-preference.write";
import {
  deliveryAttemptsTable,
  deliveryAttemptsTableMeta,
  notificationPreferenceEntity,
  notificationPreferencesTable,
} from "./tables";

export function createDeliveryFeature(): FeatureDefinition {
  return defineFeature("delivery", (r) => {
    r.describe(
      "The notification dispatch core: call `ctx.notify(notificationType, { to, route, data, priority, idempotencyKey })` from any handler to fan out a notification across all registered channels (email, in-app, push). It stores per-user channel preferences in the `notification-preference` entity, logs every attempt to `read_delivery_attempts`, and enforces idempotency and rate-limiting \u2014 add `channel-email`, `channel-in-app`, or `channel-push` on top to actually send anything.",
    );
    r.uiHints({
      displayLabel: "Notifications \u00b7 Dispatch Core",
      category: "notifications",
      recommended: true,
    });
    r.systemScope();
    // Backing table: the (tenant,user,type,channel) uniqueIndex lives only on
    // the physical table, not on the entity fields, so the generator would
    // otherwise omit it → duplicate preference rows on concurrent upserts.
    r.entity("notification-preference", notificationPreferenceEntity, {
      table: notificationPreferencesTable,
    });
    r.unmanagedTable(deliveryAttemptsTableMeta, {
      reason: "read_side.delivery_attempt_log",
    });

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
          const p = event.payload as z.infer<typeof deliveryAttemptSchema>; // @cast-boundary engine-payload
          // PK = aggregateId — replaying the same event twice conflicts on
          // the PK rather than silently duplicating the log row.
          await insertOne(tx, deliveryAttemptsTable, {
            id: event.aggregateId,
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

    // Extension point: delivery-channels (email/in-app/push). Renderer-
    // Extension-Point lebt jetzt im `renderer-foundation`-Bundle als
    // `renderer` (Multi-Kind-Plugin-Contract). delivery hostet keinen
    // eigenen mehr — channel-email nimmt renderer als direkte
    // Konstruktor-Option (siehe email-channel.ts), nicht via Extension-
    // Usage. Migration 2026-05-19.
    r.extendsRegistrar("deliveryChannel", {
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
