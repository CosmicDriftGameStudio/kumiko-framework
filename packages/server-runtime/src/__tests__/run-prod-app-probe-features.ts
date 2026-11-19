// Probe features shared by the runProdApp integration tests: the widget entity,
// anonymous/SystemAdmin probe handlers with an MSP, and a worker-lane cron.

import { requestContext } from "@cosmicdrift/kumiko-framework/api";
import { asRawClient } from "@cosmicdrift/kumiko-framework/db";
import {
  createBooleanField,
  createEntity,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";

export const widgetEntity = createEntity({
  name: "widget",
  fields: {
    name: createTextField({ personal: false, reason: "test_fixture", required: true }),
    active: createBooleanField({ default: true }),
  },
  table: "prod_widgets",
});

export const widgetFeature = defineFeature("prod-probe", (r) => {
  r.entity(widgetEntity);
  // Anonymous query — covers the "anonymousAccess flows from runProdApp
  // through createApiEntrypoint to the auth-middleware" wiring that
  // earlier silently dropped the option in the entrypoint layer.
  r.queryHandler({
    name: "ping",
    schema: z.object({}),
    access: { roles: ["anonymous"] },
    rateLimit: { per: "ip+handler", limit: 60, windowSeconds: 60 },
    handler: async () => ({ pong: true }),
  });
  // Echoes the resolved client IP — the only way to prove a real Bun.serve
  // socket address reaches requestContext.ip end-to-end; every other test in
  // this file drives fetchHandler directly, which never exercises
  // server.requestIP().
  r.queryHandler({
    name: "ip-probe",
    schema: z.object({}),
    access: { roles: ["anonymous"] },
    rateLimit: { per: "ip+handler", limit: 60, windowSeconds: 60 },
    handler: async () => ({ ip: requestContext.get()?.ip }),
  });
  r.queryHandler({
    name: "kms-probe",
    schema: z.object({}),
    access: { roles: ["anonymous"] },
    rateLimit: { per: "ip+handler", limit: 60, windowSeconds: 60 },
    handler: async (_event, ctx) => ({ hasKms: ctx.services.kms !== undefined }),
  });
  // SystemAdmin-gated write—the target of the entry:"signature" / `wire` tests:
  // Echoing user.tenantId + roles proves that dispatch runs through the real
  // dispatcher (Zod + access check) and that the automatically constructed
  // SystemUser carries the target tenant.
  r.writeHandler({
    name: "probe-write",
    schema: z.object({ note: z.string() }),
    access: { roles: ["SystemAdmin"] },
    handler: async (event) => ({
      isSuccess: true as const,
      data: { tenantSeen: event.user.tenantId, roles: event.user.roles },
    }),
  });
  // Event + MSP pair for the local event dispatcher:
  // runProdApp is a single-container deployment, so without a local dispatcher
  // no multiStreamProjection is ever applied (Production therefore had empty
  // projections + empty kumiko_event_consumers). The write appends the event;
  // the MSP writes asynchronously to prod_probe_pings, which the test polls.
  const pingedEvent = r.defineEvent("probe-pinged", z.object({ note: z.string() }), {
    piiFields: "none",
  });
  r.writeHandler({
    name: "probe-append",
    schema: z.object({ aggregateId: z.string(), note: z.string() }),
    access: { roles: ["SystemAdmin"] },
    handler: async (event, ctx) => {
      const payload = event.payload as { aggregateId: string; note: string }; // @cast-boundary engine-payload
      // unsafeAppendEvent: this test feature does not augment the event type map,
      // so the strictly typed appendEvent narrows to never here.
      await ctx.events.unsafeAppend({
        aggregateId: payload.aggregateId,
        blindAppendReason: "test fixture appends an independent fact; ordering is not under test",
        aggregateType: "probe",
        type: pingedEvent.name,
        payload: { note: payload.note },
      });
      return { isSuccess: true as const, data: { ok: true as const } };
    },
  });
  r.multiStreamProjection({
    name: "probe-ping-projection",
    apply: {
      [pingedEvent.name]: async (event, tx) => {
        const payload = event.payload as { note: string }; // @cast-boundary engine-payload
        await asRawClient(tx).unsafe(
          `INSERT INTO prod_probe_pings (aggregate_id, note) VALUES ($1, $2)`,
          [event.aggregateId, payload.note],
        );
      },
    },
  });
});

// Worker-lane cron — the lane the data-export job (run-export-jobs) lives on.
// runProdApp must schedule it (single-instance runs both lanes); on the old
// createApiEntrypoint path it was silently never registered → exports hung.
export const cronProbeFeature = defineFeature("cron-probe", (r) => {
  r.job({
    name: "worker-lane-cron",
    trigger: { cron: "0 0 1 1 *" },
    runIn: "worker",
    handler: async () => {},
  });
});
