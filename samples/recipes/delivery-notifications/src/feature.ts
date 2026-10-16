// Delivery Notifications Sample
//
// A support ticket is created and its assignee is notified via inApp, email
// and push. The mail is a stored template: `r.notification` declares the
// variables, the default text and the subject, the boot seed writes the text
// into the template store, and a tenant can override it there.
//
// The feature code only declares WHAT to notify. HOW is handled by Delivery.

import { buildEntityTable, createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineFeature,
  QnTypes,
  qn,
  templateVariable,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

// --- Entity ---

export const ticketEntity = createEntity({
  table: "read_sample_delivery_tickets",
  fields: {
    title: createTextField({
      personal: false,
      reason: "is_business_data",
      required: true,
      maxLength: 200,
    }),
    description: createTextField({ personal: false, reason: "is_business_data", maxLength: 2000 }),
    assigneeId: createTextField({ personal: "ref" }),
    priority: createTextField({ personal: false, reason: "is_business_data", required: true }), // "low" | "normal" | "critical"
    status: createTextField({ personal: false, reason: "is_business_data", required: true }),
  },
});

export const ticketTable = buildEntityTable("ticket", ticketEntity);

function ticketExecutor() {
  return createEventStoreExecutor(ticketTable, ticketEntity, { entityName: "ticket" });
}

// --- Feature ---

export const TICKET_ASSIGNED = qn("support", QnTypes.notify, "ticket-assigned");

export const supportFeature = defineFeature("support", (r) => {
  r.requires("delivery");

  r.entity("ticket", ticketEntity);

  r.notification("ticket-assigned", {
    variables: {
      ticketId: templateVariable.text({ required: true }),
      title: templateVariable.text({ required: true }),
      description: templateVariable.text({ required: true }),
      priority: templateVariable.text({ required: true }),
      url: templateVariable.link({ required: true }),
    },
    template: {
      en: {
        body: '<h1>New ticket: <span data-variable="title"></span></h1><p><span data-variable="description"></span></p><p>Priority: <span data-variable="priority"></span></p><p><a data-button href="{{url}}">Open ticket</a></p>',
      },
    },
    meta: { en: { subject: "Support ticket #{{ticketId}} ({{priority}})" } },
    // inApp and push build their own short text; email renders the stored
    // template with the notify data as variables.
    templates: {
      inApp: (data) => ({
        title: `New ticket: ${data["title"]}`,
        body: (data["description"] as string) || "A ticket was assigned to you.",
      }),
      push: (data) => ({
        title: "New ticket",
        body: `${data["title"]} (${data["priority"]})`,
      }),
    },
  });

  r.writeHandler(
    "ticket:create",
    z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      assigneeId: z.uuid().optional(),
      priority: z.enum(["low", "normal", "critical"]),
      status: z.string().default("open"),
    }),
    async (event, ctx) => {
      const created = await ticketExecutor().create(event.payload, event.user, ctx.db);
      const assigneeId = event.payload.assigneeId;
      // No assignee, no notification.
      if (!created.isSuccess || assigneeId === undefined) return created;
      if (ctx.notify === undefined) {
        throw new Error("ticket:create needs ctx.notify, mount the delivery feature");
      }
      const ticketId = created.data.id;
      await ctx.notify(TICKET_ASSIGNED, {
        to: assigneeId,
        data: {
          ticketId,
          title: event.payload.title,
          description: event.payload.description ?? "",
          priority: event.payload.priority,
          url: `https://app.example.com/support/tickets/${ticketId}`,
        },
      });
      return created;
    },
    { access: { roles: ["Admin", "Support"] } },
  );
});
