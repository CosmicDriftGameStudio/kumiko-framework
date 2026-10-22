import {
  createBooleanField,
  createEntity,
  createEntityExecutor,
  createTextField,
  defineFeature,
  emitEvent,
  setFields,
} from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound, failUnprocessable } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";

export const ticketEntity = createEntity({
  table: "read_golden_path_tickets",
  fields: {
    title: createTextField({ personal: false, reason: "is_business_data", required: true }),
    isClosed: createBooleanField({ default: false }),
  },
});

export const helpdeskFeature = defineFeature("helpdesk", (r) => {
  const { table: ticketTable, executor: ticketExecutor } = createEntityExecutor(
    "ticket",
    ticketEntity,
  );

  r.crud("ticket", ticketEntity, {
    write: { access: { roles: ["Admin", "User"] } },
    read: { access: { roles: ["Admin", "User"] } },
    verbs: { update: false, delete: false },
  });

  const ticketClosed = r.defineEvent("ticket-closed", z.object({ resolution: z.string().min(1) }), {
    piiFields: "none",
  });

  r.writeHandler({
    name: "ticket:close",
    schema: z.object({ id: z.uuid(), resolution: z.string().min(1) }),
    access: { roles: ["Admin"] },
    handler: async (event, ctx) => {
      const ticket = await ticketExecutor.detail({ id: event.payload.id }, event.user, ctx.db);
      if (!ticket) {
        return failNotFound("ticket", event.payload.id);
      }
      if (ticket["isClosed"]) return failUnprocessable("ticket_already_closed");
      await emitEvent(ctx, ticketClosed, {
        aggregateId: event.payload.id,
        aggregateType: "ticket",
        payload: { resolution: event.payload.resolution },
      });
      return { isSuccess: true as const, data: { id: event.payload.id } };
    },
  });

  r.projection({
    name: "ticket-status",
    source: "ticket",
    table: ticketTable,
    apply: {
      [ticketClosed.name]: setFields(ticketTable, { isClosed: true }),
    },
  });

  r.screen({
    id: "ticket-list",
    type: "entityList",
    entity: "ticket",
    columns: ["title", "isClosed"],
  });
});
